# Perch — STATE (read this first)

**What:** an agent-native cloud for small software. The agent deploys the tools it builds (via MCP/CLI), tools run sandboxed with isolated storage, are shared like a Google Doc, and eject to source. Reference implementation, Node 22 + TypeScript, `node:test`, zero runtime framework.

**Why it exists:** YC Fall 2026 RFS "A Cloud for Small Software" (Koomen), sharpened so the *agent* is the primary user. Full market memo led to this build.

## Current state (2026-07-24)

- **Built end to end and green.** `npm test` = 77 tests passing; `npx tsc --noEmit` clean; `npm run demo` runs the whole thesis.
- Landing page + recipient UI + sign-in shipped and screenshot-verified (dark/amber design system).
- Verified live: CLI deploy+run of a standup logger; MCP stdio handshake + deploy-via-tool.
- **Adversarial security review done and findings fixed** (see below). It caught a real vm-escape (host-realm `Function` via injected-object `.constructor`) plus auth/DoS issues — all fixed and regression-tested.
- **Open-source-ready and self-hostable.** MIT LICENSE, SECURITY.md, CONTRIBUTING.md, LAUNCH.md (Show HN draft). `Dockerfile` + `npm start` (tsx is a runtime dep); verified a production-only `npm ci --omit=dev` install boots and deploys. Real-team auth via `PERCH_TRUSTED_PROXY_HEADER` (SSO proxy). `GET /v1/stats` for adoption signals. `perch mcp-install` one-liner. **Not yet pushed to a remote or made public — that is the user's trigger.**

## Modules (all under `src/`)

| File | Role | Tested by |
|---|---|---|
| `types.ts` | shared domain vocabulary | — |
| `store.ts` | per-app isolated SQLite facets + ACL listing | `test/store.test.ts` |
| `sandbox.ts` + `sandbox-host.mjs` | untrusted-code process runtime (vm + `--permission`) | `test/sandbox.test.ts` |
| `auth.ts`, `permissions.ts`, `ratelimit.ts` | identity, ACL truth table, token bucket | `test/permissions.test.ts` |
| `supervisor.ts` | auth->authz->ratelimit front door | `test/supervisor.test.ts` |
| `deploy.ts` | bundle validation + in-place redeploy | `test/deploy.test.ts` |
| `zip.ts` | dependency-free ZIP writer (eject) | `test/zip.test.ts` |
| `perch.ts` | HTTP server + composition root | `test/http.test.ts` |
| `client.ts`, `cli.ts`, `mcp.ts`, `tools.ts` | agent interface | `test/tools.test.ts` |
| `ui.ts` | landing + recipient UI (server-rendered) | (visual) |

## How to run

```
npm test          # full suite
npm run demo      # narrated end-to-end proof
npm run dev       # server on :8787  (PORT, PERCH_DB, PERCH_SECRET, PERCH_BASE_URL, PERCH_DEV_TOKENS)
npm run cli -- deploy ./examples/standup
npm run mcp       # MCP stdio server (PERCH_URL points at a running server)
```

## Git

Local git repo at `C:\Users\Mandar\perch` (no remote yet). Commits are conventional, per-module, each with tests green. Direct-push policy from CLAUDE.md not enforced here (no remote).

## Open seams (named, not built)

- Real OAuth (Google OIDC) behind the `AuthProvider` interface (dev email-token provider ships now).
- Stronger sandbox tier (V8 isolates / gVisor / Workers-for-Platforms) behind the `Sandbox` interface. Current boundary is honest defense-in-depth, not a hostile-multi-tenant guarantee.
- Per-file SQLite DB per app (currently one DB, app_kv keyed by appId — isolation enforced at the `appStore(appId)` interface).
- Billing, custom domains, multi-node scaling, `manifest.env` injection into the sandbox.

## Security review — fixed (2026-07-24)

- **C1 vm escape** (untrusted code reached host realm via `ctx.store.get.constructor`): fixed by realm isolation — app-facing objects are built inside the context, host bridges erased from the global, data crosses as JSON primitives; `--allow-fs-read` scoped to the src dir (DB unreadable). Regression test in place.
- **C2** dev-token endpoint now OFF by default (localhost-gated in server.ts).
- **H1** deploy requires an authenticated principal; owner derived from token, never the body.
- **H2** app responses carry a sandboxing CSP and cannot set cookies.
- **M1** rate-limit keys on the trusted socket IP; bucket map bounded.
- **M2** per-app invoke queue capped (503 on overload).
- **M3** open-redirect via backslash blocked; **M4** deploy rejects path-traversal paths; **L1** admin tokens compare in constant time; **L3** `manifest.env` now delivered to `ctx.env`.
- Residual (documented): Node `vm` is not a hostile-mt guarantee and its permission model does not cover network egress — swap the `Sandbox` for isolated-vm / Workers-for-Platforms for real hostile multi-tenancy.

## Next steps (if resumed)

1. Add a stronger sandbox adapter (QuickJS-WASM or isolated-vm) behind `Sandbox` — closes the residual egress caveat.
2. Wire Google OIDC behind `AuthProvider`.
3. Per-app subdomains for full origin isolation of app HTML (CSP sandbox is the interim mitigation).
4. Deploy: containerize the server; the sandbox needs a host that allows child processes.
