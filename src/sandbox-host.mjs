// Perch sandbox host — runs INSIDE a locked-down child process.
//
// Launched by the parent (src/sandbox.ts) with:
//   node --experimental-vm-modules --permission --allow-fs-read=<src dir> --max-old-space-size=<mb>
//
// SECURITY MODEL (hardened after review finding C1):
// A naive vm sandbox leaks the host realm: any injected HOST object (console, ctx,
// their methods) exposes `x.constructor` === host Function, and `Function('return process')()`
// then runs in the host realm, defeating everything. So the rule here is absolute:
// **the untrusted app may never hold a reference to any host-realm object.**
//
// We enforce it by building `console`, `ctx`, and `request` INSIDE the vm context via a
// trusted bootstrap that closes over two host bridge functions, then DELETES those
// functions from the context global (closures retain them; the app cannot name them).
// Every value that crosses to the app is either a context-realm object built in-context
// or a primitive, and all data marshals as JSON strings. With `codeGeneration.strings:false`,
// the context's own `Function`/`eval` are dead, so `ctx.store.get.constructor('...')` throws.
// The process-level --permission model (no fs-write/child/worker) is defense in depth.

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
      resolve(msg.value); // a JSON string (or null)
    }
    return;
  }
  if (msg && msg.t === 'invoke') {
    invoke(msg).catch((e) => {
      send({ t: 'error', invokeId: msg.invokeId, message: String((e && e.message) || e), logs: [] });
    });
  }
});

// Host-realm bridge: send a store op to the parent, resolve with a JSON string.
function storeCall(appId, op, key, value) {
  return new Promise((resolve) => {
    const id = ++seq;
    pendingStore.set(id, resolve);
    send({ t: 'store', id, appId, op, key, value });
  });
}

// The bootstrap runs in the CONTEXT. It receives the host bridges as globals, builds the
// app-facing objects from them, publishes them, and erases the host references from global.
const BOOTSTRAP = `
(() => {
  const bridge = globalThis.__bridge;   // host fn: (op, key, value) => Promise<jsonString>
  const logSink = globalThis.__log;     // host fn: (level, message) => void
  const req = JSON.parse(globalThis.__reqJson);
  const user = JSON.parse(globalThis.__userJson);
  const env = JSON.parse(globalThis.__envJson);

  const mkLog = (level) => (...args) => logSink(level, args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' '));

  const store = Object.freeze({
    get: async (k) => JSON.parse(await bridge('get', String(k))),
    set: async (k, v) => { await bridge('set', String(k), String(v)); },
    delete: async (k) => { await bridge('delete', String(k)); },
    list: async () => JSON.parse(await bridge('list')),
  });

  globalThis.console = Object.freeze({ log: mkLog('log'), info: mkLog('info'), warn: mkLog('warn'), error: mkLog('error') });
  globalThis.__perch_req = Object.freeze(req);
  globalThis.__perch_ctx = Object.freeze({ store, user: user, env: Object.freeze(env) });

  // Erase every host reference from the global. Closures above keep working; the app
  // (which runs after this) can no longer name or reflect its way to a host object.
  delete globalThis.__bridge;
  delete globalThis.__log;
  delete globalThis.__reqJson;
  delete globalThis.__userJson;
  delete globalThis.__envJson;
})();
`;

async function invoke({ invokeId, appId, source, request, user, env }) {
  const logs = [];

  const context = vm.createContext(
    {
      __bridge: (op, key, value) => storeCall(appId, op, key, value),
      __log: (level, message) => {
        logs.push(`[${level}] ${message}`);
      },
      __reqJson: JSON.stringify(request ?? {}),
      __userJson: JSON.stringify(user ?? null),
      __envJson: JSON.stringify(env ?? {}),
    },
    { codeGeneration: { strings: false, wasm: false } },
  );

  try {
    // Build the app-facing world in-context, then erase host refs.
    vm.runInContext(BOOTSTRAP, context, { filename: 'perch-bootstrap' });

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

    // Invoke the handler FROM WITHIN the context so it receives context-realm args, and
    // return its result as a JSON string (a primitive) — never a host or context object ref.
    context.__perch_handler = handler;
    const resultJson = await vm.runInContext(
      `(async () => {
         const r = await globalThis.__perch_handler(globalThis.__perch_req, globalThis.__perch_ctx);
         return JSON.stringify(r === undefined ? null : r);
       })()`,
      context,
      { filename: 'perch-driver' },
    );

    send({ t: 'result', invokeId, response: normalizeResponse(JSON.parse(resultJson)), logs });
  } catch (e) {
    send({ t: 'error', invokeId, message: String((e && e.message) || e), logs });
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
