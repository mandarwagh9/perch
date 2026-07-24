import { ROLE_RANK, type Principal, type Role, type Share, type User } from './types.ts';

/** The principals a person matches. Anonymous (null) matches only `public`. */
export function principalsOf(user: User | null): Principal[] {
  if (!user) return ['public'];
  const ps: Principal[] = [`user:${user.email.toLowerCase()}`, `org:${user.org.toLowerCase()}`, 'public'];
  for (const g of user.groups ?? []) ps.push(`group:${g}`);
  return ps;
}

/**
 * The highest role a person has on an app, or null if none. The owner is always an
 * editor; otherwise it's the max role across every share whose principal the person matches.
 */
export function effectiveRole(ownerEmail: string, shares: Share[], user: User | null): Role | null {
  if (user && user.email.toLowerCase() === ownerEmail.toLowerCase()) return 'editor';
  const mine = new Set(principalsOf(user));
  let best: Role | null = null;
  for (const s of shares) {
    if (!mine.has(s.principal)) continue;
    if (best === null || ROLE_RANK[s.role] > ROLE_RANK[best]) best = s.role;
  }
  return best;
}

export interface Decision {
  allowed: boolean;
  role: Role | null;
}

/** Does this person clear the required role for the action? */
export function authorize(ownerEmail: string, shares: Share[], user: User | null, required: Role): Decision {
  const role = effectiveRole(ownerEmail, shares, user);
  const allowed = role !== null && ROLE_RANK[role] >= ROLE_RANK[required];
  return { allowed, role };
}
