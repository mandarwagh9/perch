import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { ProcessSandbox } from '../src/sandbox.ts';
import type { AppRecord, AppRequest, User } from '../src/types.ts';

let store: Store;
let sandbox: ProcessSandbox;

beforeEach(() => {
  store = new Store(':memory:');
  sandbox = new ProcessSandbox({ storeFor: (id) => store.appStore(id), timeoutMs: 3000, idleMs: 2000 });
});

afterEach(async () => {
  await sandbox.shutdown();
  store.close();
});

function deploy(source: string, name = 'app'): AppRecord {
  return store.createApp({
    manifest: { name, entry: 'index.js' },
    files: [{ path: 'index.js', content: source }],
    ownerEmail: 'owner@acme.com',
  });
}

const req = (over: Partial<AppRequest> = {}): AppRequest => ({
  method: 'GET',
  path: '/',
  query: {},
  headers: {},
  body: null,
  ...over,
});

describe('ProcessSandbox — execution', () => {
  test('runs a handler and returns its response', async () => {
    const app = deploy(`export default async () => ({ json: { hello: 'world' } });`);
    const { response } = await sandbox.run(app, req(), null);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body!), { hello: 'world' });
  });

  test('a plain string return becomes an HTML 200', async () => {
    const app = deploy(`export default async () => '<h1>hi</h1>';`);
    const { response } = await sandbox.run(app, req(), null);
    assert.equal(response.status, 200);
    assert.match(response.headers!['content-type']!, /text\/html/);
    assert.equal(response.body, '<h1>hi</h1>');
  });

  test('the handler sees the request', async () => {
    const app = deploy(
      `export default async (r) => ({ json: { m: r.method, p: r.path, q: r.query.x, b: r.body } });`,
    );
    const { response } = await sandbox.run(app, req({ method: 'POST', path: '/go', query: { x: '7' }, body: 'hey' }), null);
    assert.deepEqual(JSON.parse(response.body!), { m: 'POST', p: '/go', q: '7', b: 'hey' });
  });

  test('the handler sees ctx.user', async () => {
    const app = deploy(`export default async (r, ctx) => ({ json: { who: ctx.user?.email ?? null } });`);
    const user: User = { email: 'alice@acme.com', org: 'acme.com' };
    const { response } = await sandbox.run(app, req(), user);
    assert.deepEqual(JSON.parse(response.body!), { who: 'alice@acme.com' });
  });

  test('console output is captured as logs', async () => {
    const app = deploy(`export default async () => { console.log('from', 'app'); return 'ok'; };`);
    const { logs } = await sandbox.run(app, req(), null);
    assert.ok(logs.some((l) => l.includes('from app')));
  });
});

describe('ProcessSandbox — persistent isolated storage via ctx', () => {
  test('data persists across requests through ctx.store', async () => {
    const app = deploy(`export default async (r, ctx) => {
      const n = Number(await ctx.store.get('n') ?? 0) + 1;
      await ctx.store.set('n', String(n));
      return { json: { n } };
    };`);
    const r1 = await sandbox.run(app, req(), null);
    const r2 = await sandbox.run(app, req(), null);
    assert.deepEqual(JSON.parse(r1.response.body!), { n: 1 });
    assert.deepEqual(JSON.parse(r2.response.body!), { n: 2 });
  });

  test('one app cannot see another app\'s stored data', async () => {
    const a = deploy(`export default async (r, ctx) => { await ctx.store.set('secret', 'A'); return 'ok'; };`, 'a');
    const b = deploy(`export default async (r, ctx) => ({ json: { seen: await ctx.store.get('secret'), keys: (await ctx.store.list()).length } });`, 'b');
    await sandbox.run(a, req(), null);
    const { response } = await sandbox.run(b, req(), null);
    assert.deepEqual(JSON.parse(response.body!), { seen: null, keys: 0 });
  });
});

describe('ProcessSandbox — the security boundary (untrusted code is contained)', () => {
  test('filesystem is unreachable (dynamic import is blocked)', async () => {
    const app = deploy(`export default async () => {
      try { const fs = await import('node:fs'); return { json: { fs: 'REACHED' } }; }
      catch (e) { return { json: { blocked: e.message } }; }
    };`);
    const { response } = await sandbox.run(app, req(), null);
    const out = JSON.parse(response.body!);
    assert.equal(out.fs, undefined);
    assert.match(out.blocked, /not allowed|blocked/i);
  });

  test('fetch / network is unavailable', async () => {
    const app = deploy(`export default async () => ({ json: { fetch: typeof fetch } });`);
    const { response } = await sandbox.run(app, req(), null);
    assert.deepEqual(JSON.parse(response.body!), { fetch: 'undefined' });
  });

  test('process / host globals are absent', async () => {
    const app = deploy(`export default async () => ({ json: { process: typeof process, require: typeof require, Buffer: typeof Buffer } });`);
    const { response } = await sandbox.run(app, req(), null);
    assert.deepEqual(JSON.parse(response.body!), { process: 'undefined', require: 'undefined', Buffer: 'undefined' });
  });

  test('cannot escape the vm to the host realm via injected-object constructors', async () => {
    // The classic vm break: reach a host-realm Function via a host object's .constructor,
    // then `return process`. Every reachable value must be context-realm only.
    const app = deploy(`export default async (req, ctx) => {
      const probe = (fn) => { try { return typeof fn(); } catch (e) { return 'blocked:' + e.name; } };
      return { json: {
        viaStore:   probe(() => ctx.store.get.constructor('return this.process')()),
        viaConsole: probe(() => console.log.constructor('return this.process')()),
        viaCtx:     probe(() => ctx.constructor.constructor('return this.process')()),
        viaReq:     probe(() => req.constructor.constructor('return this.process')()),
        viaBind:    probe(() => ctx.store.get.bind(null).constructor('return this.process')()),
      } };
    };`);
    const { response } = await sandbox.run(app, req(), null);
    const out = JSON.parse(response.body!);
    // None of these may yield the host process object.
    for (const [k, v] of Object.entries(out)) {
      assert.notEqual(v, 'object', `escape via ${k} reached a host object`);
    }
  });

  test('eval / new Function is disabled inside apps', async () => {
    const app = deploy(`export default async () => {
      try { const x = eval('1+1'); return { json: { eval: x } }; }
      catch (e) { return { json: { blocked: String(e.name) } }; }
    };`);
    const { response } = await sandbox.run(app, req(), null);
    const out = JSON.parse(response.body!);
    assert.equal(out.eval, undefined);
    assert.match(out.blocked, /EvalError/);
  });
});

describe('ProcessSandbox — resource limits', () => {
  test('an infinite loop is killed and reported as a timeout', async () => {
    const fast = new ProcessSandbox({ storeFor: (id) => store.appStore(id), timeoutMs: 600, idleMs: 2000 });
    const app = deploy(`export default async () => { while (true) {} };`);
    try {
      await assert.rejects(() => fast.run(app, req(), null), /timed out/);
    } finally {
      await fast.shutdown();
    }
  });

  test('sheds load past the queue cap instead of growing unbounded', async () => {
    const capped = new ProcessSandbox({ storeFor: (id) => store.appStore(id), timeoutMs: 500, idleMs: 2000, maxQueue: 3 });
    const app = deploy(`export default async () => { while (true) {} };`); // never completes -> queue fills
    try {
      const results = await Promise.allSettled(Array.from({ length: 8 }, () => capped.run(app, req(), null)));
      const overloaded = results.filter((r) => r.status === 'rejected' && /overloaded/.test(String(r.reason?.message))).length;
      assert.ok(overloaded >= 1, `expected some requests to be shed, got ${overloaded}`);
    } finally {
      await capped.shutdown();
    }
  });
});
