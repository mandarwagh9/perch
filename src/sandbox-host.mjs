// Perch sandbox host — runs INSIDE a locked-down child process.
//
// Launched by the parent (src/sandbox.ts) with:
//   node --experimental-vm-modules --permission --allow-fs-read=* --max-old-space-size=<mb>
//
// The permission model denies fs-write, child_process, workers, and native addons,
// so even a vm escape has a small blast radius. The PRIMARY control is the vm layer:
// untrusted app code runs as a vm.SourceTextModule whose linker denies every import,
// in a context with no process / require / fetch / Buffer. Its only I/O is the `ctx`
// capability object, whose store operations are marshalled over IPC to the parent —
// the app never holds a database handle or a credential.
//
// Plain .mjs (not TS) on purpose: the child needs no tsx loader, keeping its allowed
// surface minimal and its startup fast.

import vm from 'node:vm';

let seq = 0;
const pendingStore = new Map(); // store-request id -> resolver

function send(msg) {
  process.send?.(msg);
}

process.on('message', (msg) => {
  if (msg && msg.t === 'store-res') {
    const resolve = pendingStore.get(msg.id);
    if (resolve) {
      pendingStore.delete(msg.id);
      resolve(msg.value);
    }
    return;
  }
  if (msg && msg.t === 'invoke') {
    invoke(msg).catch((e) => {
      send({ t: 'error', invokeId: msg.invokeId, message: String((e && e.message) || e), logs: [] });
    });
  }
});

function storeCall(appId, op, key, value) {
  return new Promise((resolve) => {
    const id = ++seq;
    pendingStore.set(id, resolve);
    send({ t: 'store', id, appId, op, key, value });
  });
}

async function invoke({ invokeId, appId, source, request, user }) {
  const logs = [];
  const log =
    (level) =>
    (...args) => {
      logs.push(`[${level}] ` + args.map(stringifyArg).join(' '));
    };

  // The capability object handed to untrusted code. Frozen; store I/O goes over IPC.
  const store = Object.freeze({
    get: (k) => storeCall(appId, 'get', String(k)),
    set: (k, v) => storeCall(appId, 'set', String(k), String(v)),
    delete: (k) => storeCall(appId, 'delete', String(k)),
    list: () => storeCall(appId, 'list'),
  });
  const ctx = Object.freeze({ store, user: user ?? null });

  const sandboxGlobals = {
    console: Object.freeze({ log: log('log'), info: log('info'), warn: log('warn'), error: log('error') }),
    ctx,
  };
  const context = vm.createContext(sandboxGlobals, {
    codeGeneration: { strings: false, wasm: false }, // no eval / new Function / wasm inside apps
  });

  try {
    const mod = new vm.SourceTextModule(source, {
      context,
      identifier: `perch-app:${appId}`,
      importModuleDynamically: () => {
        throw new Error('imports are not allowed in Perch apps');
      },
    });
    await mod.link(() => {
      throw new Error('imports are not allowed in Perch apps');
    });
    await mod.evaluate();

    const handler = mod.namespace.default;
    if (typeof handler !== 'function') {
      throw new Error('app must `export default` a handler function');
    }
    const raw = await handler(request, ctx);
    send({ t: 'result', invokeId, response: normalizeResponse(raw), logs });
  } catch (e) {
    send({ t: 'error', invokeId, message: String((e && e.message) || e), logs });
  }
}

function stringifyArg(a) {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// Coerce whatever the handler returned into a well-formed AppResponse.
function normalizeResponse(raw) {
  if (raw == null) return { status: 204, headers: {}, body: '' };
  if (typeof raw === 'string') return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: raw };
  const status = typeof raw.status === 'number' ? raw.status : 200;
  const headers = raw.headers && typeof raw.headers === 'object' ? raw.headers : {};
  if ('json' in raw && raw.json !== undefined) {
    return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(raw.json) };
  }
  return { status, headers, body: typeof raw.body === 'string' ? raw.body : raw.body == null ? '' : String(raw.body) };
}

send({ t: 'ready' });
