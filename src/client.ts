import type { AppFile, Manifest, Principal, Role } from './types.ts';
import type { DeployResult } from './deploy.ts';

export interface DeployArgs {
  name: string;
  entry?: string;
  files?: AppFile[];
  /** Convenience for single-file apps: the handler source. Becomes files:[{path:entry,content:code}]. */
  code?: string;
  appId?: string; // redeploy in place
  adminToken?: string;
  ownerEmail?: string; // dev-mode attribution when no bearer token
  env?: Record<string, string>;
}

export interface ListedApp {
  id: string;
  name: string;
  owner: string;
  createdAt: number;
  url: string;
}

/** A thin HTTP client for a running Perch. Shared by the CLI and the MCP server. */
export class PerchClient {
  constructor(
    public baseUrl: string,
    private token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string): void {
    this.token = token;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json', ...extra };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(extra),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private async jsonOrThrow(res: Response): Promise<any> {
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(`${msg} (${res.status})`);
    }
    return data;
  }

  async devToken(email: string, groups: string[] = []): Promise<string> {
    const data = await this.jsonOrThrow(await this.req('POST', '/v1/auth/dev-token', { email, groups }));
    return data.token as string;
  }

  async deploy(args: DeployArgs): Promise<DeployResult> {
    const entry = args.entry ?? 'index.js';
    const files = args.files ?? (args.code !== undefined ? [{ path: entry, content: args.code }] : []);
    const manifest: Manifest = { name: args.name, entry, ...(args.env ? { env: args.env } : {}) };
    return this.jsonOrThrow(
      await this.req(
        'POST',
        '/v1/deploy',
        { manifest, files, ownerEmail: args.ownerEmail, appId: args.appId, adminToken: args.adminToken },
        args.adminToken ? { 'x-perch-admin': args.adminToken } : {},
      ),
    );
  }

  async list(): Promise<ListedApp[]> {
    const data = await this.jsonOrThrow(await this.req('GET', '/v1/apps'));
    return data.apps as ListedApp[];
  }

  async share(appId: string, principal: Principal, role: Role, adminToken?: string): Promise<{ shares: unknown }> {
    return this.jsonOrThrow(await this.req('POST', `/v1/apps/${appId}/share`, { principal, role }, adminToken ? { 'x-perch-admin': adminToken } : {}));
  }

  async unshare(appId: string, principal: Principal, adminToken?: string): Promise<{ shares: unknown }> {
    return this.jsonOrThrow(await this.req('DELETE', `/v1/apps/${appId}/share`, { principal }, adminToken ? { 'x-perch-admin': adminToken } : {}));
  }

  async logs(appId: string, adminToken?: string): Promise<string[]> {
    const data = await this.jsonOrThrow(await this.req('GET', `/v1/apps/${appId}/logs`, undefined, adminToken ? { 'x-perch-admin': adminToken } : {}));
    return data.logs as string[];
  }

  async source(appId: string): Promise<{ manifest: Manifest; files: AppFile[] }> {
    return this.jsonOrThrow(await this.req('GET', `/v1/apps/${appId}/source`));
  }

  async ejectZip(appId: string): Promise<Buffer> {
    const res = await this.req('GET', `/v1/apps/${appId}/eject`);
    if (!res.ok) throw new Error(`eject failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(appId: string, adminToken?: string): Promise<{ deleted: string }> {
    return this.jsonOrThrow(await this.req('DELETE', `/v1/apps/${appId}`, undefined, adminToken ? { 'x-perch-admin': adminToken } : {}));
  }
}
