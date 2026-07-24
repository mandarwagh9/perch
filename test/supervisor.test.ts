import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { TokenAuth } from '../src/auth.ts';
import { ProcessSandbox } from '../src/sandbox.ts';
import { Supervisor } from '../src/supervisor.ts';
import { RateLimiter } from '../src/ratelimit.ts';
import type { AppRecord, AppRequest } from '../src/types.ts';

let store: Store;
let sandbox: ProcessSandbox;
let auth: TokenAuth;
let sup: Supervisor;

beforeEach(() => {
  store = new Store(':memory:');
  sandbox = new ProcessSandbox({ storeFor: (id) => store.appStore(id), timeoutMs: 3000, idleMs: 2000 });
  auth = new TokenAuth('supervisor-test-secret');
  sup = new Supervisor({ store, auth, sandbox });
});

afterEach(async () => {
  await sandbox.shutdown();
  store.close();
});

function deploy(source: string): AppRecord {
  return store.createApp({
    manifest: { name: 'tool', entry: 'index.js' },
    files: [{ path: 'index.js', content: source }],
    ownerEmail: 'owner@acme.com',
  });
}

const req = (): AppRequest => ({ method: 'GET', path: '/', query: {}, headers: {}, body: null });
const OK = `export default async () => ({ json: { ok: true } });`;

describe('Supervisor — the front door', () => {
  test('unknown app → 404', async () => {
    const { response } = await sup.handleAppRequest('nope', req(), null);
    assert.equal(response.status, 404);
  });

  test('anonymous caller on a private app → 401 (and app code never runs)', async () => {
    const app = deploy(OK);
    const { response } = await sup.handleAppRequest(app.id, req(), null);
    assert.equal(response.status, 401);
  });

  test('authenticated but unshared caller → 403', async () => {
    const app = deploy(OK);
    const token = auth.issue('stranger@other.com');
    const { response } = await sup.handleAppRequest(app.id, req(), token);
    assert.equal(response.status, 403);
  });

  test('owner is served (200) and the app runs', async () => {
    const app = deploy(OK);
    const token = auth.issue('owner@acme.com');
    const { response } = await sup.handleAppRequest(app.id, req(), token);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body!), { ok: true });
  });

  test('an org-shared teammate is served after the share is added', async () => {
    const app = deploy(OK);
    const token = auth.issue('teammate@acme.com');
    assert.equal((await sup.handleAppRequest(app.id, req(), token)).response.status, 403);
    store.putShare(app.id, 'org:acme.com', 'user');
    assert.equal((await sup.handleAppRequest(app.id, req(), token)).response.status, 200);
  });

  test('a public share serves an anonymous visitor', async () => {
    const app = deploy(OK);
    store.putShare(app.id, 'public', 'user');
    assert.equal((await sup.handleAppRequest(app.id, req(), null)).response.status, 200);
  });

  test('rate limiting returns 429 once the budget is spent', async () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 2, refillPerSec: 0, now: () => t });
    const limited = new Supervisor({ store, auth, sandbox, limiter });
    const app = deploy(OK);
    store.putShare(app.id, 'public', 'user');
    assert.equal((await limited.handleAppRequest(app.id, req(), null)).response.status, 200);
    assert.equal((await limited.handleAppRequest(app.id, req(), null)).response.status, 200);
    assert.equal((await limited.handleAppRequest(app.id, req(), null)).response.status, 429);
  });

  test('a crashing app yields 500 without leaking internals', async () => {
    const app = deploy(`export default async () => { throw new Error('boom-secret-detail'); };`);
    const token = auth.issue('owner@acme.com');
    const { response, logs } = await sup.handleAppRequest(app.id, req(), token);
    assert.equal(response.status, 500);
    assert.equal(response.body, 'Application error');
    assert.ok(!JSON.stringify(response).includes('boom-secret-detail')); // detail stays server-side
    assert.ok(logs.join(' ').includes('boom-secret-detail')); // but is captured for the owner
  });
});

describe('Supervisor — management authorization', () => {
  test('the admin token grants management', () => {
    const app = deploy(OK);
    assert.equal(sup.canManage(app, null, app.adminToken).ok, true);
    assert.equal(sup.canManage(app, null, 'wrong-token').ok, false);
  });

  test('an editor bearer token grants management; a plain user does not', () => {
    const app = deploy(OK);
    store.putShare(app.id, 'user:ed@acme.com', 'editor');
    store.putShare(app.id, 'user:plain@acme.com', 'user');
    assert.equal(sup.canManage(app, auth.issue('ed@acme.com'), null).ok, true);
    assert.equal(sup.canManage(app, auth.issue('plain@acme.com'), null).ok, false);
  });
});
