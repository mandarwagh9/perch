import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AppRecord, AppRequest, AppResponse, AppStore, User } from './types.ts';

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST_PATH = path.join(SRC_DIR, 'sandbox-host.mjs');

export interface RunResult {
  response: AppResponse;
  logs: string[];
}

/** A swappable runtime for untrusted app code. Process impl now; V8-isolate / WfP later. */
export interface Sandbox {
  run(app: AppRecord, request: AppRequest, user: User | null): Promise<RunResult>;
  shutdown(): Promise<void>;
}

export interface ProcessSandboxOptions {
  /** Supplies the isolated storage facet for an app. The parent owns it; the app never does. */
  storeFor: (appId: string) => AppStore;
  timeoutMs?: number; // wall-clock cap per request (default 5000)
  idleMs?: number; // kill a warm child after this much inactivity — scale-to-zero (default 30000)
  memMb?: number; // per-app heap cap (default 128)
  maxQueue?: number; // max in-flight+queued invokes per app before shedding load (default 32)
}

interface Inflight {
  invokeId: number;
  resolve: (r: RunResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

interface Entry {
  child: ChildProcess;
  ready: Promise<void>;
  inflight: Inflight | null;
  tail: Promise<unknown>; // serializes invokes per child
  idleTimer: NodeJS.Timeout | null;
  stderr: string[];
  pending: number; // in-flight + queued invokes, for load-shedding
}

/**
 * ProcessSandbox — a pool of locked-down child processes, at most one warm per app.
 *
 * Scale-to-zero: a child is spawned on first request and killed after `idleMs` of
 * inactivity, so an idle app costs nothing (the lesson Glitch's always-on containers
 * taught). Every request is auth'd by the supervisor BEFORE it reaches here.
 */
export class ProcessSandbox implements Sandbox {
  private entries = new Map<string, Entry>();
  private seq = 0;
  private opts: Required<ProcessSandboxOptions>;
  private closed = false;

  constructor(options: ProcessSandboxOptions) {
    this.opts = {
      timeoutMs: 5000,
      idleMs: 30_000,
      memMb: 128,
      maxQueue: 32,
      ...options,
    };
  }

  async run(app: AppRecord, request: AppRequest, user: User | null): Promise<RunResult> {
    if (this.closed) throw new Error('sandbox is shut down');
    const entry = this.getOrSpawn(app.id);
    // Shed load rather than grow an unbounded queue: one child serves an app one request
    // at a time, so a flood on a slow app is bounded here.
    if (entry.pending >= this.opts.maxQueue) {
      throw new Error('app is overloaded, try again shortly');
    }
    entry.pending += 1;
    // Serialize invocations on a single child so store IPC never interleaves.
    const result = entry.tail.then(
      () => this.invokeOn(entry, app, request, user),
      () => this.invokeOn(entry, app, request, user),
    );
    entry.tail = result.then(
      () => undefined,
      () => undefined,
    );
    result.then(
      () => (entry.pending -= 1),
      () => (entry.pending -= 1),
    );
    return result;
  }

  private getOrSpawn(appId: string): Entry {
    let entry = this.entries.get(appId);
    if (entry && !entry.child.killed) {
      this.touchIdle(appId, entry);
      return entry;
    }
    entry = this.spawn(appId);
    this.entries.set(appId, entry);
    return entry;
  }

  private spawn(appId: string): Entry {
    const child = fork(HOST_PATH, [], {
      execArgv: [
        '--no-warnings',
        '--experimental-vm-modules',
        '--permission',
        // Scope reads to the sandbox source dir only. The app's code arrives over IPC (not
        // a file), so after startup the child needs no fs at all. Crucially this EXCLUDES
        // the control-plane DB under .perch-data/, so even a vm escape cannot read it.
        `--allow-fs-read=${SRC_DIR}`,
        `--allow-fs-read=${SRC_DIR}${path.sep}*`,
        `--max-old-space-size=${this.opts.memMb}`,
      ],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH }, // minimal env — no secrets leak into the sandbox host
    });

    const entry: Entry = {
      child,
      inflight: null,
      tail: Promise.resolve(),
      idleTimer: null,
      stderr: [],
      pending: 0,
      ready: new Promise<void>((resolve) => {
        const onMsg = (m: unknown) => {
          if (isMsg(m) && m.t === 'ready') {
            child.off('message', onMsg);
            resolve();
          }
        };
        child.on('message', onMsg);
      }),
    };

    child.stderr?.on('data', (d: Buffer) => {
      entry.stderr.push(d.toString());
      if (entry.stderr.length > 50) entry.stderr.shift();
    });

    child.on('message', (m: unknown) => this.onMessage(appId, entry, m));
    child.on('exit', () => this.onExit(appId, entry));

    this.touchIdle(appId, entry);
    return entry;
  }

  private onMessage(appId: string, entry: Entry, m: unknown): void {
    if (!isMsg(m)) return;
    if (m.t === 'store') {
      // Service the app's capability call against ITS facet only.
      const store = this.opts.storeFor(appId);
      let value: unknown;
      try {
        if (m.op === 'get') value = store.get(String(m.key));
        else if (m.op === 'set') store.set(String(m.key), String(m.value));
        else if (m.op === 'delete') store.delete(String(m.key));
        else if (m.op === 'list') value = store.list();
      } catch (e) {
        value = null;
      }
      // Reply with a JSON string so only primitives cross the realm boundary.
      entry.child.send({ t: 'store-res', id: m.id, value: JSON.stringify(value === undefined ? null : value) });
      return;
    }
    if ((m.t === 'result' || m.t === 'error') && entry.inflight && m.invokeId === entry.inflight.invokeId) {
      const inflight = entry.inflight;
      entry.inflight = null;
      clearTimeout(inflight.timer);
      if (m.t === 'result') {
        inflight.resolve({ response: m.response as AppResponse, logs: (m.logs as string[]) ?? [] });
      } else {
        const err = new Error(String(m.message)) as Error & { logs?: string[] };
        err.logs = (m.logs as string[]) ?? [];
        inflight.reject(err);
      }
    }
  }

  private onExit(appId: string, entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.inflight) {
      const inflight = entry.inflight;
      entry.inflight = null;
      clearTimeout(inflight.timer);
      inflight.reject(new Error(`sandbox exited unexpectedly: ${entry.stderr.join('').slice(-500) || 'no output'}`));
    }
    if (this.entries.get(appId) === entry) this.entries.delete(appId);
  }

  private invokeOn(entry: Entry, app: AppRecord, request: AppRequest, user: User | null): Promise<RunResult> {
    return entry.ready.then(
      () =>
        new Promise<RunResult>((resolve, reject) => {
          if (entry.child.killed) {
            reject(new Error('sandbox child is not available'));
            return;
          }
          const invokeId = ++this.seq;
          const timer = setTimeout(() => {
            if (entry.inflight && entry.inflight.invokeId === invokeId) {
              entry.inflight = null;
              try {
                entry.child.kill('SIGKILL');
              } catch {
                /* already gone */
              }
              reject(new Error(`app timed out after ${this.opts.timeoutMs}ms`));
            }
          }, this.opts.timeoutMs);

          entry.inflight = { invokeId, resolve, reject, timer };
          this.touchIdle(app.id, entry);
          entry.child.send({
            t: 'invoke',
            invokeId,
            appId: app.id,
            source: entrySource(app),
            request,
            user,
            env: app.manifest.env ?? {},
          });
        }),
    );
  }

  private touchIdle(appId: string, entry: Entry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      if (!entry.inflight) {
        try {
          entry.child.kill();
        } catch {
          /* already gone */
        }
        if (this.entries.get(appId) === entry) this.entries.delete(appId);
      }
    }, this.opts.idleMs);
    entry.idleTimer.unref?.();
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const [, entry] of this.entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      if (entry.inflight) clearTimeout(entry.inflight.timer);
      try {
        entry.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    this.entries.clear();
  }
}

/** Resolve the app's entry module source from its bundle. */
function entrySource(app: AppRecord): string {
  const entry = app.manifest.entry;
  const file = app.files.find((f) => f.path === entry) ?? app.files[0];
  if (!file) throw new Error(`app ${app.id} has no entry file (${entry})`);
  return file.content;
}

type Msg =
  | { t: 'ready' }
  | { t: 'store'; id: number; appId: string; op: string; key?: string; value?: string }
  | { t: 'result'; invokeId: number; response: unknown; logs: unknown }
  | { t: 'error'; invokeId: number; message: unknown; logs: unknown };

function isMsg(m: unknown): m is Msg {
  return typeof m === 'object' && m !== null && typeof (m as { t?: unknown }).t === 'string';
}
