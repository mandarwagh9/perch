import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { Store } from './store.ts';
import { TokenAuth, type AuthProvider } from './auth.ts';
import { ProcessSandbox, type Sandbox } from './sandbox.ts';
import { Supervisor } from './supervisor.ts';
import { LogStore } from './logs.ts';
import { deploy, DeployError, type DeployInput } from './deploy.ts';
import { authorize } from './permissions.ts';
import { makeZip } from './zip.ts';
import { renderHome, renderMyTools, renderAppFrame, renderSignin } from './ui.ts';
import type { AppRequest, Principal, Role } from './types.ts';

export interface PerchOptions {
  dbPath?: string;
  secret?: string;
  baseUrl?: string;
  /** Dev-only endpoint that mints a session token for any email. Off in production. */
  allowDevTokens?: boolean;
}

export class Perch {
  readonly store: Store;
  readonly auth: TokenAuth;
  readonly sandbox: Sandbox;
  readonly supervisor: Supervisor;
  readonly logs = new LogStore();
  readonly baseUrl: string;
  private allowDevTokens: boolean;
  private server: http.Server | null = null;

  constructor(opts: PerchOptions = {}) {
    this.store = new Store(opts.dbPath ?? ':memory:');
    this.auth = new TokenAuth(opts.secret ?? randomBytes(24).toString('hex'));
    this.sandbox = new ProcessSandbox({ storeFor: (id) => this.store.appStore(id) });
    this.supervisor = new Supervisor({ store: this.store, auth: this.auth, sandbox: this.sandbox });
    this.baseUrl = opts.baseUrl ?? 'http://localhost:8787';
    this.allowDevTokens = opts.allowDevTokens ?? true;
  }

  get authProvider(): AuthProvider {
    return this.auth;
  }

  handler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      await this.route(req, res);
    } catch (e) {
      sendJson(res, 500, { error: 'internal', message: (e as Error).message });
    }
  };

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const p = url.pathname;
    const method = req.method ?? 'GET';
    const token = bearer(req);
    const sess = token ?? cookie(req, 'perch_session'); // bearer (agents) or cookie (browser)

    // ---- app requests: /a/:appId/* ----
    if (p.startsWith('/a/')) return this.serveApp(req, res, url, method, token);

    // ---- sign-in (browser sessions) ----
    if (p === '/signin' && method === 'GET') return sendHtml(res, 200, renderSignin(safeNext(url.searchParams.get('next'))));
    if (p === '/signin' && method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      const email = (form.get('email') ?? '').trim();
      const next = safeNext(form.get('next'));
      if (!email.includes('@')) return sendHtml(res, 400, renderSignin(next, 'Please enter a valid email.'));
      const tok = this.auth.issue(email);
      res.writeHead(302, { location: next, 'set-cookie': `perch_session=${encodeURIComponent(tok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` });
      res.end();
      return;
    }

    // ---- recipient UI ----
    if (p === '/' && accepts(req, 'text/html')) return sendHtml(res, 200, renderHome(this.baseUrl));
    if (p === '/my') {
      const user = this.auth.identify(sess);
      if (!user) { res.writeHead(302, { location: '/signin?next=%2Fmy' }); res.end(); return; }
      const apps = this.store.listAppsForPrincipal(user);
      return sendHtml(res, 200, renderMyTools(user, apps));
    }

    // ---- control plane: /v1/* ----
    if (p === '/' ) return sendJson(res, 200, { name: 'perch', ok: true, docs: `${this.baseUrl}/` });

    if (p === '/v1/auth/dev-token' && method === 'POST') {
      if (!this.allowDevTokens) return sendJson(res, 404, { error: 'not_found' });
      const body = await readJson(req);
      const email = String((body as { email?: unknown }).email ?? '');
      if (!email.includes('@')) return sendJson(res, 400, { error: 'bad_email' });
      const groups = Array.isArray((body as { groups?: unknown }).groups) ? ((body as { groups: string[] }).groups) : [];
      return sendJson(res, 200, { token: this.auth.issue(email, groups), email });
    }

    if (p === '/v1/deploy' && method === 'POST') return this.deployRoute(req, res, token);

    if (p === '/v1/apps' && method === 'GET') {
      const user = this.auth.identify(sess);
      if (!user) return sendJson(res, 401, { error: 'unauthenticated' });
      const apps = this.store.listAppsForPrincipal(user).map((a) => ({ id: a.id, name: a.name, owner: a.ownerEmail, createdAt: a.createdAt, url: `${this.baseUrl}/a/${a.id}` }));
      return sendJson(res, 200, { apps });
    }

    const appRoute = p.match(/^\/v1\/apps\/([^/]+)(\/(share|logs|eject|source))?$/);
    if (appRoute) return this.appAdminRoute(req, res, method, sess, appRoute[1]!, appRoute[3]);

    return sendJson(res, 404, { error: 'not_found' });
  }

  private async deployRoute(req: http.IncomingMessage, res: http.ServerResponse, token: string | null): Promise<void> {
    const body = (await readJson(req)) as Partial<DeployInput> & { ownerEmail?: string };
    const user = this.auth.identify(token);
    const adminHeader = header(req, 'x-perch-admin');
    const ownerEmail = user?.email ?? body.ownerEmail;
    if (!body.appId && !ownerEmail) return sendJson(res, 401, { error: 'unauthenticated', message: 'a bearer token or ownerEmail is required to deploy' });
    try {
      const result = deploy(
        this.store,
        {
          manifest: body.manifest!,
          files: body.files ?? [],
          ownerEmail: ownerEmail ?? 'unknown@local',
          appId: body.appId,
          adminToken: body.adminToken ?? adminHeader ?? undefined,
        },
        this.baseUrl,
      );
      return sendJson(res, 200, result);
    } catch (e) {
      if (e instanceof DeployError) return sendJson(res, 400, { error: e.code, message: e.message });
      throw e;
    }
  }

  private async appAdminRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
    token: string | null,
    appId: string,
    sub: string | undefined,
  ): Promise<void> {
    const app = this.store.getApp(appId);
    if (!app) return sendJson(res, 404, { error: 'not_found' });
    const adminToken = header(req, 'x-perch-admin');
    const manage = this.supervisor.canManage(app, token, adminToken);
    const user = this.auth.identify(token);
    const canRun = authorize(app.ownerEmail, this.store.getShares(appId), user, 'user').allowed || manage.ok;

    if (sub === 'share') {
      if (!manage.ok) return sendJson(res, manage.user ? 403 : 401, { error: 'forbidden' });
      if (method === 'POST') {
        const body = (await readJson(req)) as { principal?: string; role?: string };
        if (!isPrincipal(body.principal) || !isRole(body.role)) return sendJson(res, 400, { error: 'bad_share' });
        this.store.putShare(appId, body.principal, body.role);
        return sendJson(res, 200, { shares: this.store.getShares(appId) });
      }
      if (method === 'DELETE') {
        const body = (await readJson(req)) as { principal?: string };
        if (!isPrincipal(body.principal)) return sendJson(res, 400, { error: 'bad_principal' });
        this.store.removeShare(appId, body.principal);
        return sendJson(res, 200, { shares: this.store.getShares(appId) });
      }
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (sub === 'logs') {
      if (!manage.ok) return sendJson(res, manage.user ? 403 : 401, { error: 'forbidden' });
      return sendJson(res, 200, { logs: this.logs.get(appId) });
    }

    if (sub === 'source') {
      // JSON source for agents (the zip is the human-facing portable form).
      if (!canRun) return sendJson(res, user ? 403 : 401, { error: 'forbidden' });
      return sendJson(res, 200, { manifest: app.manifest, files: app.files });
    }

    if (sub === 'eject') {
      if (!canRun) return sendJson(res, user ? 403 : 401, { error: 'forbidden' });
      const zip = makeZip([
        { path: 'manifest.json', content: JSON.stringify(app.manifest, null, 2) },
        ...app.files.map((f) => ({ path: f.path, content: f.content })),
        { path: 'README.md', content: `# ${app.name}\n\nEjected from Perch. Runs anywhere — this is your code, portable like a file.\n` },
      ]);
      res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${app.id}.zip"` });
      res.end(zip);
      return;
    }

    // /v1/apps/:id — metadata or delete
    if (method === 'GET') {
      if (!canRun) return sendJson(res, user ? 403 : 401, { error: 'forbidden' });
      return sendJson(res, 200, {
        id: app.id,
        name: app.name,
        owner: app.ownerEmail,
        createdAt: app.createdAt,
        url: `${this.baseUrl}/a/${app.id}`,
        shares: manage.ok ? this.store.getShares(appId) : undefined,
        canManage: manage.ok,
      });
    }
    if (method === 'DELETE') {
      if (!manage.ok) return sendJson(res, manage.user ? 403 : 401, { error: 'forbidden' });
      this.store.deleteApp(appId);
      return sendJson(res, 200, { deleted: appId });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  private async serveApp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    method: string,
    token: string | null,
  ): Promise<void> {
    const rest = url.pathname.slice('/a/'.length);
    const slash = rest.indexOf('/');
    const appId = slash === -1 ? rest : rest.slice(0, slash);
    const subPath = slash === -1 ? '/' : rest.slice(slash);

    // A browser hitting the bare app URL with no session gets a friendly sign-in frame.
    const sessionToken = token ?? cookie(req, 'perch_session');
    const body = await readBody(req);
    const appReq: AppRequest = {
      method,
      path: subPath || '/',
      query: Object.fromEntries(url.searchParams),
      headers: pickHeaders(req),
      body: body.length ? body : null,
    };

    const { response, logs } = await this.supervisor.handleAppRequest(appId, appReq, sessionToken);
    this.logs.append(appId, logs);

    if (response.status === 401 && accepts(req, 'text/html')) {
      return sendHtml(res, 401, renderAppFrame(appId, this.baseUrl));
    }
    res.writeHead(response.status ?? 200, { 'content-type': 'text/plain', ...(response.headers ?? {}) });
    res.end(response.body ?? '');
  }

  async listen(port = 8787): Promise<{ port: number; url: string; close: () => Promise<void> }> {
    this.server = http.createServer(this.handler);
    await new Promise<void>((resolve) => this.server!.listen(port, resolve));
    const addr = this.server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    return { port: actualPort, url: `http://localhost:${actualPort}`, close: () => this.close() };
  }

  async close(): Promise<void> {
    if (this.server) await new Promise<void>((r) => this.server!.close(() => r()));
    await this.sandbox.shutdown();
    this.store.close();
  }
}

// ---- tiny http helpers ----

function sendJson(res: http.ServerResponse, status: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
function bearer(req: http.IncomingMessage): string | null {
  const h = header(req, 'authorization');
  if (h && h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return null;
}
function header(req: http.IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}
function cookie(req: http.IncomingMessage, name: string): string | null {
  const raw = header(req, 'cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function accepts(req: http.IncomingMessage, type: string): boolean {
  return (header(req, 'accept') ?? '').includes(type);
}
function pickHeaders(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['content-type', 'x-forwarded-for', 'user-agent']) {
    const v = header(req, k);
    if (v) out[k] = v;
  }
  return out;
}
// Only allow same-origin relative redirects (no open-redirect via //host or http://).
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/my';
  return next;
}
function isPrincipal(v: unknown): v is Principal {
  return typeof v === 'string' && (v === 'public' || /^(user|group|org):.+/.test(v));
}
function isRole(v: unknown): v is Role {
  return v === 'viewer' || v === 'user' || v === 'editor';
}

export { sendText };
