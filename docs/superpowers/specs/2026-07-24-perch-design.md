# Perch — an agent-native cloud for small software

**Date:** 2026-07-24
**Status:** Design (approved by founder-operator, autonomous build)
**One-liner:** The cloud where the software your agent builds *lands* — deployed by the agent in one call, shareable like a Google Doc, portable like a file.

---

## 1. Why this exists (the thesis)

Agents made *building* bespoke 1–50-user tools easy, but **deploying, securing, and sharing** them is still hard, because incumbent clouds were built for Big Software. Three hard sub-problems remain:

1. **Per-company environment customization**
2. **Auth & permissions**
3. **Letting nontechnical users share arbitrary code securely**

Bar: *"as easy to share with your colleagues as a Google Doc."*

**Our specific bet:** the primary *user* of this cloud is not a human clicking "deploy" — it is the **agent** building the software. When Claude/Cursor/an agent finishes a small tool, it calls Perch directly (MCP + REST) and gets back a shareable, permissioned URL. Humans never learn deploy vocabulary; agents never touch human dashboards. Perch is the deployment substrate the agent reaches for *while building*.

This choice is what makes Perch defensible rather than "another PaaS." The graveyard (Glitch, Heroku, Darklang, Airplane) teaches four hard lessons; the architecture below is designed to answer all four:

| Graveyard lesson | Architectural answer |
|---|---|
| Glitch died on **always-on container-per-app economics** + weak monetization | **Scale-to-zero**: apps are cold by default, spawned per request, idle-killed. No idle cost. |
| Heroku killed free tier on **fraud/abuse** of anonymous hosting | **Auth-gated by construction**: every app request passes the supervisor; no anonymous compute. |
| Darklang died on **proprietary-editor lock-in** in the agent era | **Runs-anywhere + eject-to-source**: apps are plain portable code; agents author in their own tools. |
| Airplane **stranded customers** on shutdown | **Eject-to-source is a first-class, always-available primitive**, not an afterthought. |

## 2. Scope — MVP spine (ruthless YAGNI)

The one demoable loop that proves the entire thesis end to end:

> An **agent** calls `deploy(source)` → Perch stores the app, provisions **isolated storage**, assigns a URL → a **human** opens the URL, authenticated with **org identity** → the **supervisor** enforces the **share ACL** before any app code runs → the app executes **sandboxed** with a scoped `ctx` (storage + identity, never raw credentials) → the owner **shares** it Google-Doc-style → anyone can **eject** it to portable source.

Everything not on that loop is out of scope for v1: billing, custom domains, real Google OAuth (we ship a pluggable auth seam with a dev email-token provider), horizontal scaling, a marketplace. These are noted as seams, not built.

## 3. Architecture — deep modules with narrow interfaces

Five modules, each independently testable, communicating through small interfaces. A module's consumer should never need to read its internals.

```
                      ┌──────────────────────────────────────┐
   agent (MCP/CLI) ─▶ │  Control Plane API (http)            │
   REST client     ─▶ │  /v1/deploy /apps /share /eject      │
                      └───────────┬──────────────────────────┘
                                  │ uses
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                          ▼
   ┌─────────┐            ┌──────────────┐            ┌─────────────┐
   │  Store  │            │  Supervisor  │            │   Deploy    │
   │ (SQLite)│◀───────────│ auth+authz+  │            │  pipeline   │
   │ meta +  │            │ ratelimit    │            │ validate/   │
   │ per-app │            └──────┬───────┘            │ persist     │
   │ facets  │                   │ forwards into      └─────────────┘
   └─────────┘                   ▼
                          ┌──────────────┐
   human ─▶ /a/:appId ─▶  │   Sandbox    │  child node --permission
                          │  scoped ctx  │  (no fs/net), IPC bridge
                          │  scale-to-0  │  ctx.store / ctx.user
                          └──────────────┘
```

### 3.1 Store — `src/store.ts`
- **Purpose:** durable state for the control plane, and one **isolated storage facet per app**.
- **Interface:** `createApp`, `getApp`, `listAppsForPrincipal(principal)`, `putShare`, `getShares`, `deleteApp`, `appStore(appId)` → a scoped KV/SQL handle bound to that app only.
- **Isolation invariant:** an app can only ever read/write its own facet. Facet = a table namespace keyed by `appId` (v1) with a hard interface boundary; a per-file SQLite DB is a drop-in later. This is the Cloudflare "each app gets its own database" idea, at reference scale.
- **Depends on:** `node:sqlite`.

### 3.2 Sandbox — `src/sandbox.ts`
- **Purpose:** execute untrusted app code safely, cheaply, and disposably.
- **Interface:** `run(app, request, ctx) → response`. Swappable `Sandbox` type so `process` (v1) can be replaced by `isolated-vm` / Cloudflare Workers-for-Platforms later without touching callers.
- **App contract:** an app is a module exporting `export default async function handler(request, ctx) { return response }`. `request` = `{method, path, query, headers, body}`. `ctx` = `{ store, user }` — a **capability bridge**: the app calls `ctx.store.get/set/query` and reads `ctx.user`, but the actual DB handle and credentials live in the supervisor, not the sandbox. The app process is launched with `node --permission` and **no** `--allow-fs*` / `--allow-child-process` / `--allow-worker`, so it cannot touch the filesystem, spawn processes, or open its own network — its only I/O is the IPC channel back to the supervisor.
- **Economics:** cold by default. Spawn on first request, serve, keep warm briefly, idle-kill. Enforce wall-clock timeout + memory cap (`--max-old-space-size`). No idle cost → dodges Glitch's grave.
- **Honesty note:** process + Node permission model is a *real* isolation boundary but not a hostile-multi-tenant guarantee; the spec documents the upgrade path (V8 isolates / gVisor / WfP) behind the same interface. A stronger QuickJS-WASM tier is a planned hardening pass.

### 3.3 Supervisor — `src/supervisor.ts` (+ `src/auth.ts`)
- **Purpose:** the Cloudflare "your code runs first" pattern. Every request to `/a/:appId/*` hits the supervisor **before** any app code: authenticate → authorize against the share ACL → rate-limit → construct the scoped `ctx` → forward into the sandbox. Answers sub-problems #2 and #3.
- **Auth seam:** `AuthProvider` interface (`identify(request) → user | null`). v1 provider: signed email-token (dev) with org = email domain. Google OIDC is a drop-in.
- **ACL model:** share = `(appId, principal, role)`. principal ∈ {`user:email`, `group:name`, `org:domain`, `public`}. role ∈ {`viewer`, `user`, `editor`} (viewer=see listing, user=run it, editor=run+manage shares). Owner is implicit editor.

### 3.4 Deploy pipeline — `src/deploy.ts`
- **Purpose:** turn an agent's `deploy(source, manifest)` into a running app. Validate manifest, size-limit + static-lint the source (reject obvious escapes like top-level `require('fs')`), persist the bundle, provision the storage facet, assign URL + admin token, return `{appId, url, adminToken}`.

### 3.5 Agent interface — `src/cli.ts`, `src/mcp.ts`
- **Purpose:** the differentiator. Agents deploy while building.
- **CLI:** `perch deploy ./app`, `perch list`, `perch share <app> <principal> <role>`, `perch logs <app>`, `perch eject <app>`.
- **MCP server:** tools `perch_deploy`, `perch_list`, `perch_logs`, `perch_share`, `perch_set_env`, `perch_eject` — so an agent in Claude Code/Cursor calls Perch as first-class tools. This is the literal realization of "a cloud for small software that agents use while building the software."

## 4. Data flow (the loop, precisely)

1. **Deploy (agent):** `POST /v1/deploy {manifest, files}` → deploy pipeline → Store.createApp + provision facet → `{appId, url:/a/:appId, adminToken}`.
2. **Open (human):** `GET /a/:appId/...` → Supervisor: AuthProvider.identify → ACL check (403 if unauthorized) → rate-limit → build `ctx{store: Store.appStore(appId), user}` → Sandbox.run(app, request, ctx) → app `handler` returns response → supervisor returns it.
3. **Share (owner):** `POST /v1/apps/:appId/share {principal, role}` (requires editor) → Store.putShare.
4. **Eject (anyone with rights):** `GET /v1/apps/:appId/eject` → zip of the exact source + manifest → portable, runs anywhere.

## 5. Error handling
- Deploy: reject oversize/invalid manifest/failed static-lint with 4xx + machine-readable reason (agents parse it).
- Runtime: sandbox timeout/crash/memory → 500 with captured logs; supervisor never leaks the supervisor's own state into the app response.
- Authz: unauthenticated → 401; authenticated-but-denied → 403; unknown app → 404.
- Isolation failures are treated as security bugs (tests assert an app cannot read the fs, another app's facet, or the supervisor's DB).

## 6. Testing strategy (TDD)
- **Unit:** Store isolation (app A cannot read app B's facet), ACL truth table, deploy validation/lint, sandbox capability denial (fs/net blocked), scale-to-zero lifecycle.
- **Integration:** the full §4 loop against a live in-process server — deploy → unauthorized 403 → share → authorized 200 → app persists to its facet → eject returns runnable source.
- **Security assertions as tests:** an app that tries `require('node:fs').readFileSync('/etc/hosts')` fails; an app that tries to reach app B's data gets nothing.
- Runner: `node --test` (built-in), TypeScript via `tsx`/`--experimental-strip-types`.

## 7. Success criteria
- One command spins up Perch locally.
- A real example agent-built tool (e.g., a team "standup logger" with persistence) deploys via CLI **and** MCP, runs sandboxed, stores data in its isolated facet, is denied to non-shared users and served to shared users, and ejects to source that runs standalone.
- Full test suite green, including the security-isolation tests.
- README + STATE.md so the disk is the source of truth for the next session.

## 8. Non-goals (v1)
Billing, real OAuth, custom domains, autoscaling/multi-node, marketplace, non-JS languages. Each has a named seam; none is built now.
