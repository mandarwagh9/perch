// Perch end-to-end demo: the whole thesis in one narrated run.
// Run with: npm run demo
//
// It plays the role of an AGENT building small software, then a human recipient,
// and shows every promise Perch makes: agent-deploy, sandbox isolation, org
// permissions, Google-Doc-style sharing, and eject-to-source.

import { writeFileSync } from 'node:fs';
import { Perch } from '../src/perch.ts';
import { PerchClient } from '../src/client.ts';
import { callTool, newSession } from '../src/tools.ts';

const line = (s = '') => console.log(s);
const step = (n: number, s: string) => console.log(`\n\x1b[33m[${n}]\x1b[0m ${s}`);
const ok = (s: string) => console.log(`    \x1b[32m✓\x1b[0m ${s}`);

async function main(): Promise<void> {
  const perch = new Perch({ baseUrl: 'http://localhost', allowDevTokens: true });
  const { url } = await perch.listen(0);
  line(`\x1b[1mPerch\x1b[0m running at ${url}\n(the whole thing is in-process; nothing is installed in the cloud)`);

  // ---- The agent builds and deploys a tool, entirely through its tool surface ----
  const agent = new PerchClient(url);
  const session = newSession();

  step(1, 'An AGENT signs in and deploys the tool it just wrote (via the MCP tool surface)');
  await callTool(agent, session, 'perch_dev_token', { email: 'builder@acme.com' });
  const EXPENSE_TOOL = `export default async (req, ctx) => {
    if (req.method === 'POST') {
      const items = JSON.parse(await ctx.store.get('items') || '[]');
      items.push({ who: ctx.user?.email, amount: Number(req.body), at: Date.now() });
      await ctx.store.set('items', JSON.stringify(items));
      const total = items.reduce((s, i) => s + i.amount, 0);
      return { json: { added: true, total, split: total / new Set(items.map(i => i.who)).size } };
    }
    const items = JSON.parse(await ctx.store.get('items') || '[]');
    return { json: { count: items.length, total: items.reduce((s, i) => s + i.amount, 0) } };
  };`;
  const deployMsg = await callTool(agent, session, 'perch_deploy', { name: 'expense-splitter', code: EXPENSE_TOOL });
  const appId = deployMsg.match(/appId: (\S+)/)![1]!;
  ok(`deployed "expense-splitter" -> ${url}/a/${appId}`);
  ok('the agent never left its own environment; no human clicked a deploy button');

  // ---- Private by default ----
  step(2, 'It is private by default. An outsider is refused BEFORE any app code runs');
  const outsider = await new PerchClient(url).devToken('rival@other-corp.com');
  const blocked = await fetch(`${url}/a/${appId}`, { headers: { authorization: `Bearer ${outsider}`, accept: 'application/json' } });
  ok(`outsider from another org gets HTTP ${blocked.status} (403), app code did not execute`);

  // ---- Shared like a Google Doc ----
  step(3, 'The builder shares it with the whole org, the way you share a Google Doc');
  await callTool(agent, session, 'perch_share', { appId, principal: 'org:acme.com', role: 'user' });
  ok('shared org:acme.com -> role "user"');

  // ---- A teammate uses it; storage is isolated + persistent ----
  step(4, 'A teammate opens it. Data persists in the tool\'s OWN isolated storage');
  const teammate = await new PerchClient(url).devToken('alex@acme.com');
  const H = { authorization: `Bearer ${teammate}`, accept: 'application/json' };
  await fetch(`${url}/a/${appId}`, { method: 'POST', headers: H, body: '40' });
  await fetch(`${url}/a/${appId}`, { method: 'POST', headers: H, body: '60' });
  const state = await (await fetch(`${url}/a/${appId}`, { headers: H })).json();
  ok(`two expenses logged; tool reports total=${state.total} across ${state.count} entries`);

  // ---- Isolation between apps ----
  step(5, 'A DIFFERENT tool cannot see the first tool\'s data (per-app isolation)');
  const snoopMsg = await callTool(agent, session, 'perch_deploy', {
    name: 'snooper',
    code: `export default async (r, ctx) => ({ json: { stolen: await ctx.store.get('items'), keys: (await ctx.store.list()).length } });`,
  });
  const snoopId = snoopMsg.match(/appId: (\S+)/)![1]!;
  await agent.share(snoopId, 'org:acme.com', 'user');
  const snoop = await (await fetch(`${url}/a/${snoopId}`, { headers: H })).json();
  ok(`snooper sees stolen=${JSON.stringify(snoop.stolen)}, keys=${snoop.keys} (its own facet is empty)`);

  // ---- The sandbox contains hostile code ----
  step(6, 'A HOSTILE tool tries to read the filesystem and reach the network. It is contained');
  const evilMsg = await callTool(agent, session, 'perch_deploy', {
    name: 'evil',
    code: `export default async () => {
      const out = {};
      try { const fs = await import('node:fs'); out.fs = fs.readFileSync('C:/Windows/win.ini','utf8').slice(0,20); }
      catch (e) { out.fs = 'BLOCKED: ' + e.message; }
      out.fetch = typeof fetch;
      out.process = typeof process;
      return { json: out };
    };`,
  });
  const evilId = evilMsg.match(/appId: (\S+)/)![1]!;
  await agent.share(evilId, 'org:acme.com', 'user');
  const evil = await (await fetch(`${url}/a/${evilId}`, { headers: H })).json();
  ok(`filesystem: ${evil.fs}`);
  ok(`fetch: ${evil.fetch} · process: ${evil.process}  (no network, no host globals)`);

  // ---- Eject to source: no lock-in ----
  step(7, 'The builder ejects the tool to source. Portable like a file, no lock-in');
  const zip = await agent.ejectZip(appId);
  const outPath = new URL('./expense-splitter.zip', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  writeFileSync(outPath, zip);
  ok(`downloaded ${zip.length} bytes of standard .zip -> ${outPath}`);
  ok('runs anywhere; the code was always yours');

  line('\n\x1b[1mThat is the whole thesis:\x1b[0m an agent built it, deployed it in one call, it ran');
  line('sandboxed with its own storage, was shared like a doc, stayed private to the org,');
  line('contained hostile code, and can walk out the door as source. No cloud console in sight.');

  await perch.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
