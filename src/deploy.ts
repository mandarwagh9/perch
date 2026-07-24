import type { Store } from './store.ts';
import { safeEqual } from './supervisor.ts';
import type { AppFile, Manifest } from './types.ts';

// Reject anything that could escape the bundle root when written to disk (zip-slip):
// absolute paths, drive letters, backslashes, leading slash, or a `..` segment.
function isUnsafePath(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.startsWith('\\') || p.includes('\\')) return true;
  if (/^[A-Za-z]:/.test(p)) return true; // drive letter
  return p.split('/').some((seg) => seg === '..');
}

export class DeployError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeployError';
  }
}

export interface DeployInput {
  manifest: Manifest;
  files: AppFile[];
  ownerEmail: string;
  /** For in-place redeploy (agents iterating on the same URL). Requires adminToken. */
  appId?: string;
  adminToken?: string;
}

export interface DeployResult {
  appId: string;
  url: string;
  adminToken: string;
  name: string;
  updated: boolean;
}

const MAX_BUNDLE_BYTES = 1_000_000; // 1 MB — small software stays small

/** Validate a bundle before it becomes a running app. Throws DeployError with a machine code. */
export function validateBundle(manifest: unknown, files: unknown): asserts manifest is Manifest {
  if (typeof manifest !== 'object' || manifest === null) throw new DeployError('bad_manifest', 'manifest is required');
  const m = manifest as Record<string, unknown>;
  if (typeof m.name !== 'string' || m.name.trim() === '') throw new DeployError('bad_manifest', 'manifest.name is required');
  if (typeof m.entry !== 'string' || m.entry.trim() === '') throw new DeployError('bad_manifest', 'manifest.entry is required');
  if (!Array.isArray(files) || files.length === 0) throw new DeployError('no_files', 'at least one file is required');

  let total = 0;
  for (const f of files as AppFile[]) {
    if (typeof f?.path !== 'string' || typeof f?.content !== 'string') {
      throw new DeployError('bad_file', 'each file needs a string path and content');
    }
    if (isUnsafePath(f.path)) {
      throw new DeployError('bad_path', `unsafe file path "${f.path}" (no absolute paths, "..", or backslashes)`);
    }
    total += Buffer.byteLength(f.content, 'utf8');
  }
  if (total > MAX_BUNDLE_BYTES) throw new DeployError('too_big', `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);

  const entry = (files as AppFile[]).find((f) => f.path === m.entry);
  if (!entry) throw new DeployError('missing_entry', `entry file "${String(m.entry)}" not found in bundle`);
  if (!/export\s+default/.test(entry.content)) {
    throw new DeployError('no_default_export', `entry "${String(m.entry)}" must \`export default\` a handler function`);
  }
}

/**
 * Deploy pipeline — turn an agent's bundle into a running, shareable app.
 * Creates a new app, or updates an existing one in place when a valid appId+adminToken
 * are supplied (so an agent can iterate without the URL changing).
 */
export function deploy(store: Store, input: DeployInput, baseUrl: string): DeployResult {
  validateBundle(input.manifest, input.files);

  if (input.appId) {
    const existing = store.getApp(input.appId);
    if (!existing) throw new DeployError('not_found', `app ${input.appId} does not exist`);
    if (!safeEqual(input.adminToken, existing.adminToken)) {
      throw new DeployError('forbidden', 'redeploy requires the correct adminToken');
    }
    store.updateFiles(existing.id, input.files, input.manifest);
    return { appId: existing.id, url: `${baseUrl}/a/${existing.id}`, adminToken: existing.adminToken, name: input.manifest.name, updated: true };
  }

  const app = store.createApp({ manifest: input.manifest, files: input.files, ownerEmail: input.ownerEmail });
  return { appId: app.id, url: `${baseUrl}/a/${app.id}`, adminToken: app.adminToken, name: app.name, updated: false };
}
