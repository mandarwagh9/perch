import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Perch } from '../src/perch.ts';

let perch: Perch;
let base: string;

before(async () => {
  perch = new Perch({ baseUrl: 'http://localhost', allowDevTokens: true });
  const { url } = await perch.listen(0);
  base = url;
});

after(async () => {
  await perch.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

async function devToken(email: string): Promise<string> {
  const r = await fetch(`${base}/v1/auth/dev-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return (await json(r)).token as string;
}

// A realistic agent-built tool: a shared team counter persisted in its isolated facet.
const COUNTER_APP = `export default async (req, ctx) => {
  const n = Number(await ctx.store.get('count') ?? 0) + 1;
  await ctx.store.set('count', String(n));
  return { json: { count: n, by: ctx.user?.email ?? 'anon' } };
};`;

describe('Perch HTTP — the full loop over the wire', () => {
  test('an agent deploys, the tool is private, sharing opens it, data persists, it ejects, then deletes', async () => {
    const ownerToken = await devToken('owner@acme.com');

    // 1. Agent deploys (authenticated as owner).
    const deployRes = await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ manifest: { name: 'team-counter', entry: 'index.js' }, files: [{ path: 'index.js', content: COUNTER_APP }] }),
    });
    assert.equal(deployRes.status, 200);
    const { appId, adminToken } = await json(deployRes);
    assert.ok(appId && adminToken);

    // 2. Private by default: an anonymous visitor is refused, and app code never runs.
    const anon = await fetch(`${base}/a/${appId}`, { headers: { accept: 'application/json' } });
    assert.equal(anon.status, 401);

    // 3. Owner shares it with the whole org.
    const share = await fetch(`${base}/v1/apps/${appId}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-perch-admin': adminToken },
      body: JSON.stringify({ principal: 'org:acme.com', role: 'user' }),
    });
    assert.equal(share.status, 200);

    // 4. A teammate can now run it; data persists in the app's isolated facet.
    const teammate = await devToken('teammate@acme.com');
    const run1 = await fetch(`${base}/a/${appId}`, { headers: { authorization: `Bearer ${teammate}`, accept: 'application/json' } });
    assert.equal(run1.status, 200);
    assert.equal((await json(run1)).count, 1);
    const run2 = await fetch(`${base}/a/${appId}`, { headers: { authorization: `Bearer ${teammate}`, accept: 'application/json' } });
    assert.equal((await json(run2)).count, 2);

    // 5. An outsider (different org) is still forbidden.
    const outsider = await devToken('spy@evil.com');
    const denied = await fetch(`${base}/a/${appId}`, { headers: { authorization: `Bearer ${outsider}`, accept: 'application/json' } });
    assert.equal(denied.status, 403);

    // 6. The owner sees it in their tool list.
    const list = await fetch(`${base}/v1/apps`, { headers: { authorization: `Bearer ${ownerToken}` } });
    const apps = (await json(list)).apps as Array<{ id: string }>;
    assert.ok(apps.some((a) => a.id === appId));

    // 7. Eject to source — portable like a file.
    const eject = await fetch(`${base}/a/${appId}`.replace(`/a/${appId}`, `/v1/apps/${appId}/eject`), {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    assert.equal(eject.status, 200);
    assert.equal(eject.headers.get('content-type'), 'application/zip');
    const zipBuf = Buffer.from(await eject.arrayBuffer());
    assert.equal(zipBuf.readUInt32LE(0), 0x04034b50); // it's a real zip

    // 8. Delete removes it.
    const del = await fetch(`${base}/v1/apps/${appId}`, { method: 'DELETE', headers: { 'x-perch-admin': adminToken } });
    assert.equal(del.status, 200);
    const gone = await fetch(`${base}/a/${appId}`, { headers: { accept: 'application/json' } });
    assert.equal(gone.status, 404);
  });

  test('a bad bundle is rejected with a machine-readable code', async () => {
    const tok = await devToken('a@acme.com');
    const res = await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ manifest: { name: 'x', entry: 'index.js' }, files: [{ path: 'index.js', content: 'no export here' }] }),
    });
    assert.equal(res.status, 400);
    assert.equal((await json(res)).error, 'no_default_export');
  });

  test('deploying a new app WITHOUT a token is rejected (no anonymous code execution)', async () => {
    const res = await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: { name: 'x', entry: 'index.js' }, files: [{ path: 'index.js', content: 'export default async () => "hi"' }] }),
    });
    assert.equal(res.status, 401);
  });

  test('owner cannot be spoofed via the body — it comes from the token', async () => {
    const tok = await devToken('real@acme.com');
    const res = await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ownerEmail: 'ceo@victim.com', manifest: { name: 'spoof', entry: 'index.js' }, files: [{ path: 'index.js', content: 'export default async () => "x"' }] }),
    });
    const { appId } = await json(res);
    // The victim must NOT see this app; the real deployer owns it.
    const victim = await devToken('ceo@victim.com');
    const victimList = (await json(await fetch(`${base}/v1/apps`, { headers: { authorization: `Bearer ${victim}` } }))).apps as Array<{ id: string }>;
    assert.ok(!victimList.some((a) => a.id === appId));
  });

  test('a path-traversal file path is rejected (zip-slip guard)', async () => {
    const tok = await devToken('a@acme.com');
    const res = await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ manifest: { name: 'evil', entry: 'index.js' }, files: [{ path: 'index.js', content: 'export default async()=>1' }, { path: '../../escape.js', content: 'x' }] }),
    });
    assert.equal(res.status, 400);
    assert.equal((await json(res)).error, 'bad_path');
  });

  test('app responses carry a sandboxing CSP and cannot set cookies', async () => {
    const tok = await devToken('a@acme.com');
    const { appId } = await json(await fetch(`${base}/v1/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ manifest: { name: 'headery', entry: 'index.js' }, files: [{ path: 'index.js', content: 'export default async () => ({ headers: { "set-cookie": "evil=1" }, body: "hi" })' }] }),
    }));
    await fetch(`${base}/v1/apps/${appId}/share`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ principal: 'public', role: 'user' }) });
    const r = await fetch(`${base}/a/${appId}`);
    assert.match(r.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.equal(r.headers.get('set-cookie'), null); // app-set cookie was stripped
  });

  test('sign-in rejects an open-redirect via backslash', async () => {
    const r = await fetch(`${base}/signin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a@acme.com&next=/%5Cevil.com',
      redirect: 'manual',
    });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/my'); // not /\evil.com
  });
});
