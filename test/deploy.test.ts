import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { deploy, validateBundle, DeployError } from '../src/deploy.ts';

const good = { name: 'notes', entry: 'index.js' };
const goodFiles = [{ path: 'index.js', content: 'export default async () => "hi"' }];

describe('validateBundle', () => {
  test('accepts a well-formed bundle', () => {
    assert.doesNotThrow(() => validateBundle(good, goodFiles));
  });
  test('rejects a missing name', () => {
    assert.throws(() => validateBundle({ entry: 'index.js' }, goodFiles), /name is required/);
  });
  test('rejects when there are no files', () => {
    assert.throws(() => validateBundle(good, []), /at least one file/);
  });
  test('rejects a missing entry file', () => {
    assert.throws(() => validateBundle({ name: 'x', entry: 'main.js' }, goodFiles), /not found/);
  });
  test('rejects an entry without a default export (agent-friendly error)', () => {
    assert.throws(
      () => validateBundle(good, [{ path: 'index.js', content: 'const x = 1' }]),
      /export default/,
    );
  });
  test('rejects an oversized bundle', () => {
    const big = [{ path: 'index.js', content: 'export default 1;' + 'x'.repeat(1_000_001) }];
    assert.throws(() => validateBundle(good, big), /exceeds/);
  });
  test('throws a DeployError carrying a machine code', () => {
    try {
      validateBundle({}, goodFiles);
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof DeployError);
      assert.equal((e as DeployError).code, 'bad_manifest');
    }
  });
});

describe('deploy', () => {
  test('creates a new app and returns a url + adminToken', () => {
    const store = new Store(':memory:');
    const r = deploy(store, { manifest: good, files: goodFiles, ownerEmail: 'a@acme.com' }, 'http://x');
    assert.match(r.url, /^http:\/\/x\/a\/notes-/);
    assert.ok(r.adminToken.length > 0);
    assert.equal(r.updated, false);
    store.close();
  });

  test('redeploys in place with a valid adminToken, keeping the URL', () => {
    const store = new Store(':memory:');
    const first = deploy(store, { manifest: good, files: goodFiles, ownerEmail: 'a@acme.com' }, 'http://x');
    const second = deploy(
      store,
      { manifest: { ...good, name: 'notes-v2' }, files: [{ path: 'index.js', content: 'export default async () => "v2"' }], ownerEmail: 'a@acme.com', appId: first.appId, adminToken: first.adminToken },
      'http://x',
    );
    assert.equal(second.appId, first.appId);
    assert.equal(second.url, first.url);
    assert.equal(second.updated, true);
    assert.equal(store.getApp(first.appId)!.files[0]!.content, 'export default async () => "v2"');
    store.close();
  });

  test('rejects a redeploy with the wrong adminToken', () => {
    const store = new Store(':memory:');
    const first = deploy(store, { manifest: good, files: goodFiles, ownerEmail: 'a@acme.com' }, 'http://x');
    assert.throws(
      () => deploy(store, { manifest: good, files: goodFiles, ownerEmail: 'a@acme.com', appId: first.appId, adminToken: 'nope' }, 'http://x'),
      /adminToken/,
    );
    store.close();
  });
});
