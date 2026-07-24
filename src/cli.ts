#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PerchClient, type DeployArgs } from './client.ts';
import type { AppFile, Manifest, Principal, Role } from './types.ts';

const STATE_DIR = '.perch';
const STATE_FILE = path.join(STATE_DIR, 'state.json');

interface State {
  url?: string;
  session?: string;
  admins: Record<string, string>;
}

function loadState(): State {
  try {
    return { admins: {}, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    return { admins: {} };
  }
}
function saveState(s: State): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function client(state: State): PerchClient {
  const url = process.env.PERCH_URL ?? state.url ?? 'http://localhost:8787';
  const token = process.env.PERCH_TOKEN ?? state.session;
  return new PerchClient(url, token);
}

const SKIP = new Set(['node_modules', '.git', '.perch', 'dist', 'coverage']);
function collectFiles(dir: string, base = dir): AppFile[] {
  const out: AppFile[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectFiles(full, base));
    else if (st.size < 512_000) {
      try {
        out.push({ path: path.relative(base, full).split(path.sep).join('/'), content: readFileSync(full, 'utf8') });
      } catch {
        /* skip unreadable/binary */
      }
    }
  }
  return out;
}

function bundleFrom(target: string, nameFlag?: string): { manifest: Manifest; files: AppFile[] } {
  const st = statSync(target);
  if (st.isFile()) {
    const entry = path.basename(target);
    return { manifest: { name: nameFlag ?? entry.replace(/\.[^.]+$/, ''), entry }, files: [{ path: entry, content: readFileSync(target, 'utf8') }] };
  }
  const files = collectFiles(target);
  let manifest: Manifest = { name: nameFlag ?? path.basename(path.resolve(target)), entry: 'index.js' };
  const mf = files.find((f) => f.path === 'perch.json');
  if (mf) manifest = { ...manifest, ...(JSON.parse(mf.content) as Partial<Manifest>) };
  if (nameFlag) manifest.name = nameFlag;
  return { manifest, files };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const state = loadState();
  const c = client(state);

  switch (cmd) {
    case 'token': {
      const email = rest[0];
      if (!email) return fail('usage: perch token <email>');
      const token = await c.devToken(email);
      state.session = token;
      saveState(state);
      console.log(`signed in as ${email}`);
      console.log(`token saved to ${STATE_FILE}`);
      break;
    }
    case 'deploy': {
      const target = rest.find((a) => !a.startsWith('--')) ?? '.';
      const updateId = flag(rest, '--update');
      const name = flag(rest, '--name');
      const owner = flag(rest, '--owner') ?? process.env.PERCH_OWNER;
      const { manifest, files } = bundleFrom(target, name);
      const args: DeployArgs = { name: manifest.name, entry: manifest.entry, files, ownerEmail: owner };
      if (updateId) {
        args.appId = updateId;
        args.adminToken = state.admins[updateId];
      }
      const r = await c.deploy(args);
      state.admins[r.appId] = r.adminToken;
      saveState(state);
      console.log(`${r.updated ? 'updated' : 'deployed'}: ${r.name}`);
      console.log(`  url:      ${r.url}`);
      console.log(`  appId:    ${r.appId}`);
      console.log(`  admin:    ${r.adminToken} (saved)`);
      console.log(`\nShare it:  perch share ${r.appId} org:<your-domain> user`);
      break;
    }
    case 'list': {
      const apps = await c.list();
      if (!apps.length) return void console.log('no tools yet');
      for (const a of apps) console.log(`${a.id}\t${a.name}\t${a.url}`);
      break;
    }
    case 'share': {
      const [appId, principal, role] = rest as [string, Principal, Role];
      if (!appId || !principal || !role) return fail('usage: perch share <appId> <principal> <role>');
      await c.share(appId, principal, role, state.admins[appId]);
      console.log(`shared ${appId} → ${principal} (${role})`);
      break;
    }
    case 'logs': {
      const appId = rest[0];
      if (!appId) return fail('usage: perch logs <appId>');
      const logs = await c.logs(appId, state.admins[appId]);
      console.log(logs.length ? logs.join('\n') : '(no logs yet)');
      break;
    }
    case 'eject': {
      const appId = rest[0];
      if (!appId) return fail('usage: perch eject <appId> [out.zip]');
      const out = rest[1] ?? `${appId}.zip`;
      writeFileSync(out, await c.ejectZip(appId));
      console.log(`ejected ${appId} → ${out} (runs anywhere; it's your code)`);
      break;
    }
    case 'rm': {
      const appId = rest[0];
      if (!appId) return fail('usage: perch rm <appId>');
      await c.remove(appId, state.admins[appId]);
      console.log(`removed ${appId}`);
      break;
    }
    case 'open': {
      const appId = rest[0];
      console.log(`${c.baseUrl}/a/${appId}`);
      break;
    }
    default:
      console.log(`perch — deploy the small software your agent builds.

usage:
  perch token <email>                 get a dev session token
  perch deploy <path> [--name n]      deploy a file or directory
  perch deploy <path> --update <id>   redeploy in place (same URL)
  perch list                          list tools you can see
  perch share <id> <principal> <role> share (principal: user:me@x.com | org:x.com | group:g | public)
  perch logs <id>                     recent app logs
  perch eject <id> [out.zip]          download the source (portable)
  perch rm <id>                       delete a tool
  perch open <id>                     print the tool URL

env: PERCH_URL (default http://localhost:8787), PERCH_TOKEN, PERCH_OWNER`);
  }
}

function fail(msg: string): void {
  console.error(msg);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
});
