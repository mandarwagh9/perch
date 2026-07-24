import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Perch } from '../src/perch.ts';
import { PerchClient } from '../src/client.ts';
import { callTool, newSession, TOOL_DEFS } from '../src/tools.ts';

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

describe('agent tool surface (what an MCP client drives)', () => {
  test('every tool advertises a name, description, and object schema', () => {
    for (const t of TOOL_DEFS) {
      assert.ok(t.name.startsWith('perch_'));
      assert.ok(t.description.length > 10);
      assert.equal((t.inputSchema as { type: string }).type, 'object');
    }
  });

  test('an agent can sign in, deploy, share, read source, and iterate — all through tools', async () => {
    const client = new PerchClient(base);
    const session = newSession();

    // 1. Identify (dev token).
    await callTool(client, session, 'perch_dev_token', { email: 'agent-owner@acme.com' });

    // 2. Deploy a tool the "agent" wrote.
    const deployMsg = await callTool(client, session, 'perch_deploy', {
      name: 'greeter',
      code: 'export default async (req, ctx) => ({ json: { hi: ctx.user?.email ?? "anon" } });',
    });
    assert.match(deployMsg, /Deployed "greeter"/);
    const appId = deployMsg.match(/appId: (\S+)/)![1]!;

    // 3. It shows up in the agent's list.
    const listMsg = await callTool(client, session, 'perch_list', {});
    assert.match(listMsg, new RegExp(appId));

    // 4. Share with the org.
    const shareMsg = await callTool(client, session, 'perch_share', { appId, principal: 'org:acme.com', role: 'user' });
    assert.match(shareMsg, /Shared/);

    // 5. Read the source back (so the agent can revise).
    const srcMsg = await callTool(client, session, 'perch_source', { appId });
    assert.match(srcMsg, /export default/);

    // 6. Iterate: redeploy in place (same appId), proving the admin token was remembered.
    const updateMsg = await callTool(client, session, 'perch_deploy', {
      name: 'greeter',
      appId,
      code: 'export default async () => ({ json: { v: 2 } });',
    });
    assert.match(updateMsg, /Updated "greeter"/);
    assert.match(updateMsg, new RegExp(appId)); // same id → same URL

    // 7. Confirm the running tool now returns v2.
    const run = await fetch(`${base}/a/${appId}`, { headers: { accept: 'application/json' } });
    // org-shared, anonymous is not in org → 401; fetch with the owner's identity instead:
    const owner = await new PerchClient(base).devToken('agent-owner@acme.com');
    const run2 = await fetch(`${base}/a/${appId}`, { headers: { authorization: `Bearer ${owner}`, accept: 'application/json' } });
    assert.equal(run.status, 401);
    assert.deepEqual(await run2.json(), { v: 2 });
  });
});
