import { timingSafeEqual } from 'node:crypto';
import type { Store } from './store.ts';
import type { AuthProvider } from './auth.ts';
import type { Sandbox } from './sandbox.ts';
import { authorize } from './permissions.ts';
import { RateLimiter } from './ratelimit.ts';
import type { AppRecord, AppRequest, AppResponse, Role, User } from './types.ts';

/** Constant-time string compare, false on any length or value mismatch. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SupervisorDeps {
  store: Store;
  auth: AuthProvider;
  sandbox: Sandbox;
  limiter?: RateLimiter;
}

export interface SupervisorResult {
  response: AppResponse;
  /** captured app logs — the caller decides who may see them (owners, not the public) */
  logs: string[];
}

/**
 * Supervisor — Perch's front door. EVERY request to an app passes through here
 * before a single line of app code runs: identify the caller, authorize against the
 * app's shares, rate-limit, and only then forward into the sandbox with a scoped ctx.
 * This is the "your code runs first" pattern, and it's how Perch answers the RFS's
 * auth/permissions and secure-sharing sub-problems.
 */
export class Supervisor {
  private store: Store;
  private auth: AuthProvider;
  private sandbox: Sandbox;
  private limiter: RateLimiter;

  constructor(deps: SupervisorDeps) {
    this.store = deps.store;
    this.auth = deps.auth;
    this.sandbox = deps.sandbox;
    this.limiter = deps.limiter ?? new RateLimiter({ capacity: 60, refillPerSec: 10 });
  }

  /** Handle a request bound for `/a/:appId/*`. `clientIp` must be the trusted socket IP. */
  async handleAppRequest(appId: string, request: AppRequest, token: string | null, clientIp = 'local'): Promise<SupervisorResult> {
    const app = this.store.getApp(appId);
    if (!app) return plain(404, 'No such app');

    const user = this.auth.identify(token);
    const shares = this.store.getShares(appId);

    // Running an app requires at least the "user" role.
    const decision = authorize(app.ownerEmail, shares, user, 'user');
    if (!decision.allowed) {
      return user
        ? plain(403, 'You do not have access to this tool')
        : plain(401, 'Sign in to open this tool');
    }

    // Key on identity when signed in, else the trusted socket IP (never a spoofable header).
    const principalKey = user ? `u:${user.email}` : `ip:${clientIp}`;
    if (!this.limiter.take(`${appId}:${principalKey}`)) {
      return plain(429, 'Too many requests');
    }

    try {
      const { response, logs } = await this.sandbox.run(app, request, user);
      return { response, logs };
    } catch (e) {
      const err = e as Error & { logs?: string[] };
      if (/overloaded/.test(String(err.message))) {
        return { response: { status: 503, headers: { 'content-type': 'text/plain', 'retry-after': '1' }, body: 'Busy, try again' }, logs: [] };
      }
      // Never leak the failure detail into the app response, but keep it in the logs
      // so the owner can see WHY their tool broke.
      const logs = [...(err.logs ?? []), `[error] ${String(err.message)}`];
      return { response: { status: 500, headers: { 'content-type': 'text/plain' }, body: 'Application error' }, logs };
    }
  }

  /**
   * Authorize a management action (share/env/eject/delete). Two ways in:
   * a bearer token for an editor, or the app's admin token (handed to the deployer).
   */
  canManage(app: AppRecord, token: string | null, adminToken: string | null): { ok: boolean; user: User | null; role: Role | null } {
    if (safeEqual(adminToken, app.adminToken)) return { ok: true, user: null, role: 'editor' };
    const user = this.auth.identify(token);
    const shares = this.store.getShares(app.id);
    const decision = authorize(app.ownerEmail, shares, user, 'editor');
    return { ok: decision.allowed, user, role: decision.role };
  }
}

function plain(status: number, body: string): SupervisorResult {
  return { response: { status, headers: { 'content-type': 'text/plain' }, body }, logs: [] };
}
