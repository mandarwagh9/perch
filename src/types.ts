// Shared domain vocabulary for Perch.

/** A principal a tool can be shared with. */
export type Principal =
  | `user:${string}` // a single person, e.g. user:alice@acme.com
  | `group:${string}` // a named group, e.g. group:eng
  | `org:${string}` // everyone in an org (email domain), e.g. org:acme.com
  | 'public'; // anyone with the link

/** What a principal is allowed to do with a tool. */
export type Role = 'viewer' | 'user' | 'editor';
// viewer = see it in their list; user = run it; editor = run it + manage shares. Owner is implicitly editor.

export const ROLE_RANK: Record<Role, number> = { viewer: 0, user: 1, editor: 2 };

/** An authenticated person. org is derived from the email domain. */
export interface User {
  email: string;
  org: string; // email domain, e.g. acme.com
  groups?: string[];
}

/** The manifest an agent supplies when deploying. */
export interface Manifest {
  name: string;
  entry: string; // filename of the handler module, e.g. "index.js"
  description?: string;
  env?: Record<string, string>;
}

/** A file in a deployed app bundle. */
export interface AppFile {
  path: string;
  content: string;
}

/** A deployed app as stored. */
export interface AppRecord {
  id: string;
  name: string;
  ownerEmail: string;
  org: string;
  manifest: Manifest;
  files: AppFile[];
  adminToken: string;
  createdAt: number;
}

export interface Share {
  appId: string;
  principal: Principal;
  role: Role;
}

/** The request shape an app handler receives. */
export interface AppRequest {
  method: string;
  path: string; // path within the app, after /a/:appId
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | null;
}

/** The response an app handler returns. */
export interface AppResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
}

/** Scoped, capability-style storage handed to an app. Bound to one appId. */
export interface AppStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  list(): Array<{ key: string; value: string }>;
}
