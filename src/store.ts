import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import type { AppFile, AppRecord, AppStore, Manifest, Principal, Role, Share, User } from './types.ts';

export interface CreateAppInput {
  manifest: Manifest;
  files: AppFile[];
  ownerEmail: string;
}

function orgOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? email : email.slice(at + 1).toLowerCase();
}

/** A url-safe, collision-resistant, human-glanceable id: <slug>-<rand>. */
function makeId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'app';
  return `${slug}-${randomBytes(4).toString('hex')}`;
}

/**
 * Store — durable state for the control plane plus one isolated storage facet per app.
 *
 * The isolation invariant lives here and nowhere else: an app only ever touches
 * storage through `appStore(appId)`, whose every statement is bound to that appId.
 * The app never receives a raw database handle.
 */
export class Store {
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS apps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        org TEXT NOT NULL,
        manifest TEXT NOT NULL,
        files TEXT NOT NULL,
        admin_token TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shares (
        app_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (app_id, principal)
      );
      CREATE TABLE IF NOT EXISTS app_kv (
        app_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (app_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_apps_owner ON apps(owner_email);
      CREATE INDEX IF NOT EXISTS idx_shares_principal ON shares(principal);
    `);
  }

  close(): void {
    this.db.close();
  }

  // ---- apps ----

  createApp(input: CreateAppInput): AppRecord {
    const rec: AppRecord = {
      id: makeId(input.manifest.name),
      name: input.manifest.name,
      ownerEmail: input.ownerEmail.toLowerCase(),
      org: orgOf(input.ownerEmail),
      manifest: input.manifest,
      files: input.files,
      adminToken: randomBytes(24).toString('hex'),
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        `INSERT INTO apps (id, name, owner_email, org, manifest, files, admin_token, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.name,
        rec.ownerEmail,
        rec.org,
        JSON.stringify(rec.manifest),
        JSON.stringify(rec.files),
        rec.adminToken,
        rec.createdAt,
      );
    return rec;
  }

  getApp(id: string): AppRecord | null {
    const row = this.db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToApp(row) : null;
  }

  private rowToApp(row: Record<string, unknown>): AppRecord {
    return {
      id: row.id as string,
      name: row.name as string,
      ownerEmail: row.owner_email as string,
      org: row.org as string,
      manifest: JSON.parse(row.manifest as string) as Manifest,
      files: JSON.parse(row.files as string) as AppFile[],
      adminToken: row.admin_token as string,
      createdAt: row.created_at as number,
    };
  }

  deleteApp(id: string): void {
    this.db.prepare('DELETE FROM apps WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM shares WHERE app_id = ?').run(id);
    this.db.prepare('DELETE FROM app_kv WHERE app_id = ?').run(id);
  }

  updateFiles(id: string, files: AppFile[], manifest: Manifest): void {
    this.db
      .prepare('UPDATE apps SET files = ?, manifest = ?, name = ? WHERE id = ?')
      .run(JSON.stringify(files), JSON.stringify(manifest), manifest.name, id);
  }

  // ---- shares ----

  putShare(appId: string, principal: Principal, role: Role): void {
    this.db
      .prepare(
        `INSERT INTO shares (app_id, principal, role) VALUES (?, ?, ?)
         ON CONFLICT(app_id, principal) DO UPDATE SET role = excluded.role`,
      )
      .run(appId, principal, role);
  }

  removeShare(appId: string, principal: Principal): void {
    this.db.prepare('DELETE FROM shares WHERE app_id = ? AND principal = ?').run(appId, principal);
  }

  getShares(appId: string): Share[] {
    const rows = this.db
      .prepare('SELECT app_id, principal, role FROM shares WHERE app_id = ?')
      .all(appId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      appId: r.app_id as string,
      principal: r.principal as Principal,
      role: r.role as Role,
    }));
  }

  /** The principals a user matches — the set an ACL is checked against. */
  principalsOf(user: User): Principal[] {
    const ps: Principal[] = [
      `user:${user.email.toLowerCase()}`,
      `org:${user.org.toLowerCase()}`,
      'public',
    ];
    for (const g of user.groups ?? []) ps.push(`group:${g}`);
    return ps;
  }

  listAppsForPrincipal(user: User): AppRecord[] {
    const principals = this.principalsOf(user);
    const placeholders = principals.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT DISTINCT a.* FROM apps a
         LEFT JOIN shares s ON s.app_id = a.id
         WHERE a.owner_email = ? OR s.principal IN (${placeholders})
         ORDER BY a.created_at DESC`,
      )
      .all(user.email.toLowerCase(), ...principals) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToApp(r));
  }

  // ---- per-app storage facet ----

  /**
   * Returns a storage handle bound to exactly one appId. Every statement carries
   * `WHERE app_id = ?` with the bound id, so an app can never reach another's data.
   */
  appStore(appId: string): AppStore {
    const db = this.db;
    return {
      get(key: string): string | null {
        const row = db
          .prepare('SELECT value FROM app_kv WHERE app_id = ? AND key = ?')
          .get(appId, key) as { value: string } | undefined;
        return row ? row.value : null;
      },
      set(key: string, value: string): void {
        db.prepare(
          `INSERT INTO app_kv (app_id, key, value) VALUES (?, ?, ?)
           ON CONFLICT(app_id, key) DO UPDATE SET value = excluded.value`,
        ).run(appId, key, value);
      },
      delete(key: string): void {
        db.prepare('DELETE FROM app_kv WHERE app_id = ? AND key = ?').run(appId, key);
      },
      list(): Array<{ key: string; value: string }> {
        const rows = db
          .prepare('SELECT key, value FROM app_kv WHERE app_id = ? ORDER BY key')
          .all(appId) as Array<{ key: string; value: string }>;
        return rows.map((r) => ({ key: r.key, value: r.value }));
      },
    };
  }
}
