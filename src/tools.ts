import type { PerchClient } from './client.ts';
import type { AppFile, Principal, Role } from './types.ts';

// The Perch tool surface an AGENT calls while building software. This is the whole
// point of Perch: the deployer is the agent, not a human clicking a dashboard.

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'perch_deploy',
    description:
      'Deploy a small web tool the agent built and get back a shareable URL. The app is a single JS module that `export default async function handler(request, ctx)`; ctx.store is isolated per-app key-value storage and ctx.user is the signed-in viewer. Pass `code` for a single-file app, or `files` for multiple. Pass `appId` to redeploy in place (same URL).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'human name for the tool' },
        code: { type: 'string', description: 'single-file handler source (export default ...)' },
        files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
        entry: { type: 'string', description: 'entry filename (default index.js)' },
        appId: { type: 'string', description: 'redeploy this existing app in place' },
        ownerEmail: { type: 'string', description: 'owner email (dev mode, when no session token)' },
      },
      required: ['name'],
    },
  },
  { name: 'perch_list', description: 'List the tools the current session can see.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'perch_share',
    description: 'Share a tool. principal is one of: `user:email`, `org:domain`, `group:name`, or `public`. role is `viewer`, `user`, or `editor`.',
    inputSchema: { type: 'object', properties: { appId: { type: 'string' }, principal: { type: 'string' }, role: { type: 'string', enum: ['viewer', 'user', 'editor'] } }, required: ['appId', 'principal', 'role'] },
  },
  { name: 'perch_logs', description: 'Recent logs for a tool (helps the agent debug what it deployed).', inputSchema: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] } },
  { name: 'perch_source', description: 'Read back a tool\'s source files so the agent can revise them.', inputSchema: { type: 'object', properties: { appId: { type: 'string' } }, required: ['appId'] } },
  { name: 'perch_dev_token', description: 'Dev-only: obtain and use a session token for an email (so list/deploy attribute to that owner).', inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] } },
];

/** Per-connection memory: admin tokens for apps this session deployed. */
export interface ToolSession {
  admins: Map<string, string>;
}

export function newSession(): ToolSession {
  return { admins: new Map() };
}

export async function callTool(client: PerchClient, session: ToolSession, name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'perch_dev_token': {
      const token = await client.devToken(String(args.email));
      client.setToken(token);
      return `Signed in as ${String(args.email)}. Subsequent deploys and lists use this identity.`;
    }
    case 'perch_deploy': {
      const appId = args.appId ? String(args.appId) : undefined;
      const r = await client.deploy({
        name: String(args.name),
        entry: args.entry ? String(args.entry) : undefined,
        code: args.code !== undefined ? String(args.code) : undefined,
        files: Array.isArray(args.files) ? (args.files as AppFile[]) : undefined,
        ownerEmail: args.ownerEmail ? String(args.ownerEmail) : undefined,
        appId,
        adminToken: appId ? session.admins.get(appId) : undefined,
      });
      session.admins.set(r.appId, r.adminToken);
      return [
        `${r.updated ? 'Updated' : 'Deployed'} "${r.name}".`,
        `URL:   ${r.url}`,
        `appId: ${r.appId}`,
        `It's private by default. Share it with: perch_share appId=${r.appId} principal=org:<domain> role=user`,
      ].join('\n');
    }
    case 'perch_list': {
      const apps = await client.list();
      if (!apps.length) return 'No tools visible to this session.';
      return apps.map((a) => `${a.id}  ${a.name}  ${a.url}`).join('\n');
    }
    case 'perch_share': {
      const appId = String(args.appId);
      await client.share(appId, args.principal as Principal, args.role as Role, session.admins.get(appId));
      return `Shared ${appId} → ${String(args.principal)} (${String(args.role)}).`;
    }
    case 'perch_logs': {
      const appId = String(args.appId);
      const logs = await client.logs(appId, session.admins.get(appId));
      return logs.length ? logs.join('\n') : '(no logs yet)';
    }
    case 'perch_source': {
      const src = await client.source(String(args.appId));
      return src.files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
