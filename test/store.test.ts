import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import type { Manifest, User } from '../src/types.ts';

function mkManifest(name: string): Manifest {
  return { name, entry: 'index.js' };
}

function newStore(): Store {
  return new Store(':memory:');
}

describe('Store — apps', () => {
  test('createApp returns a record with id, url-safe id, adminToken', () => {
    const s = newStore();
    const app = s.createApp({
      manifest: mkManifest('standup'),
      files: [{ path: 'index.js', content: 'export default () => ({body:"hi"})' }],
      ownerEmail: 'alice@acme.com',
    });
    assert.ok(app.id.length > 0);
    assert.match(app.id, /^[a-z0-9-]+$/);
    assert.ok(app.adminToken.length >= 16);
    assert.equal(app.org, 'acme.com');
    assert.equal(app.name, 'standup');
  });

  test('getApp round-trips files and manifest', () => {
    const s = newStore();
    const created = s.createApp({
      manifest: mkManifest('notes'),
      files: [{ path: 'index.js', content: 'CODE' }],
      ownerEmail: 'bob@acme.com',
    });
    const got = s.getApp(created.id);
    assert.ok(got);
    assert.deepEqual(got!.files, [{ path: 'index.js', content: 'CODE' }]);
    assert.equal(got!.manifest.entry, 'index.js');
  });

  test('getApp returns null for unknown id', () => {
    assert.equal(newStore().getApp('nope'), null);
  });

  test('deleteApp removes the app and its shares and its facet data', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('x'), files: [], ownerEmail: 'a@acme.com' });
    s.putShare(app.id, 'org:acme.com', 'user');
    s.appStore(app.id).set('k', 'v');
    s.deleteApp(app.id);
    assert.equal(s.getApp(app.id), null);
    assert.deepEqual(s.getShares(app.id), []);
    assert.deepEqual(s.appStore(app.id).list(), []);
  });
});

describe('Store — sharing / listing (the ACL truth table)', () => {
  const alice: User = { email: 'alice@acme.com', org: 'acme.com', groups: ['eng'] };
  const carol: User = { email: 'carol@acme.com', org: 'acme.com', groups: ['sales'] };
  const dan: User = { email: 'dan@other.com', org: 'other.com' };

  test('owner sees their own app without an explicit share', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('mine'), files: [], ownerEmail: alice.email });
    assert.deepEqual(s.listAppsForPrincipal(alice).map((a) => a.id), [app.id]);
  });

  test('org share: everyone in the org sees it, outsiders do not', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('team'), files: [], ownerEmail: alice.email });
    s.putShare(app.id, 'org:acme.com', 'user');
    assert.equal(s.listAppsForPrincipal(carol).length, 1);
    assert.equal(s.listAppsForPrincipal(dan).length, 0);
  });

  test('user share: only that person sees it', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('secret'), files: [], ownerEmail: alice.email });
    s.putShare(app.id, 'user:carol@acme.com', 'user');
    assert.equal(s.listAppsForPrincipal(carol).length, 1);
    assert.equal(s.listAppsForPrincipal(dan).length, 0);
  });

  test('group share: only members of the group see it', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('engtool'), files: [], ownerEmail: alice.email });
    s.putShare(app.id, 'group:eng', 'user');
    assert.equal(s.listAppsForPrincipal(alice).length, 1); // alice in eng
    assert.equal(s.listAppsForPrincipal(carol).length, 0); // carol in sales
  });

  test('public share: anyone (including other orgs) sees it', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('open'), files: [], ownerEmail: alice.email });
    s.putShare(app.id, 'public', 'user');
    assert.equal(s.listAppsForPrincipal(dan).length, 1);
  });

  test('putShare is idempotent / upserts role', () => {
    const s = newStore();
    const app = s.createApp({ manifest: mkManifest('u'), files: [], ownerEmail: alice.email });
    s.putShare(app.id, 'user:carol@acme.com', 'viewer');
    s.putShare(app.id, 'user:carol@acme.com', 'editor');
    const shares = s.getShares(app.id);
    assert.equal(shares.length, 1);
    assert.equal(shares[0]!.role, 'editor');
  });
});

describe('Store — per-app storage facet isolation (the core invariant)', () => {
  test('an app can read back its own keys', () => {
    const s = newStore();
    const a = s.createApp({ manifest: mkManifest('a'), files: [], ownerEmail: 'x@acme.com' });
    const st = s.appStore(a.id);
    st.set('count', '1');
    assert.equal(st.get('count'), '1');
    assert.deepEqual(st.list(), [{ key: 'count', value: '1' }]);
  });

  test('app A cannot read or overwrite app B facet data', () => {
    const s = newStore();
    const a = s.createApp({ manifest: mkManifest('a'), files: [], ownerEmail: 'x@acme.com' });
    const b = s.createApp({ manifest: mkManifest('b'), files: [], ownerEmail: 'y@acme.com' });
    s.appStore(a.id).set('secret', 'A-value');
    s.appStore(b.id).set('secret', 'B-value');
    // B sees only its own value; A's is invisible and untouched.
    assert.equal(s.appStore(b.id).get('secret'), 'B-value');
    assert.equal(s.appStore(a.id).get('secret'), 'A-value');
    assert.equal(s.appStore(b.id).list().length, 1);
  });

  test('delete removes only that app key', () => {
    const s = newStore();
    const a = s.createApp({ manifest: mkManifest('a'), files: [], ownerEmail: 'x@acme.com' });
    const st = s.appStore(a.id);
    st.set('k1', 'v1');
    st.set('k2', 'v2');
    st.delete('k1');
    assert.equal(st.get('k1'), null);
    assert.equal(st.get('k2'), 'v2');
  });
});
