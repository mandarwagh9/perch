import { createHmac, timingSafeEqual } from 'node:crypto';
import type { User } from './types.ts';

/** Resolves an opaque token to a person, or null. Swap this for Google OIDC later. */
export interface AuthProvider {
  identify(token: string | null): User | null;
}

function orgOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(at + 1).toLowerCase();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

interface TokenPayload {
  email: string;
  groups?: string[];
  iat: number;
}

/**
 * TokenAuth — the v1 dev provider. HMAC-signed bearer tokens carry the person's
 * identity; org is derived from the email domain (the Google-Workspace analogue).
 * A tampered or unsigned token resolves to null. Google OIDC is a drop-in replacement
 * that implements the same `identify` interface.
 */
export class TokenAuth implements AuthProvider {
  constructor(private secret: string) {
    if (!secret || secret.length < 8) throw new Error('TokenAuth needs a secret of length >= 8');
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  /** Mint a session token for a person. In dev an endpoint calls this freely. */
  issue(email: string, groups: string[] = []): string {
    const payload: TokenPayload = { email: email.toLowerCase(), groups, iat: Date.now() };
    const body = b64url(JSON.stringify(payload));
    return `${body}.${this.sign(body)}`;
  }

  identify(token: string | null): User | null {
    if (!token) return null;
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
      if (!payload.email || typeof payload.email !== 'string') return null;
      return { email: payload.email, org: orgOf(payload.email), groups: payload.groups ?? [] };
    } catch {
      return null;
    }
  }
}
