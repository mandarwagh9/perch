# Perch — STATE (read this first)

**What:** an agent-native cloud for small software. The agent deploys the tools it builds (via MCP/CLI), tools run sandboxed with isolated storage, are shared like a Google Doc, and eject to source. Reference implementation, Node 22 + TypeScript, `node:test`, zero runtime framework.

**Why it exists:** YC Fall 2026 RFS "A Cloud for Small Software" (Koomen), sharpened so the *agent* is the primary user. Full market memo led to this build.

## Current state (2026-07-24)

- **Built end to end and green.** `npm test` = 67 tests passing; `npx tsc --noEmit` clean; `npm run demo` runs the whole thesis.
- Landing page + recipient UI + sign-in shipped and screenshot-verified (dark/amber design system).
- Verified live: CLI deploy+run of a standup logger; MCP stdio handshake + deploy-via-tool.

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

## Next steps (if resumed)

1. Address any findings from the adversarial security review (was running at end of build session).
2. Add a stronger sandbox adapter (QuickJS-WASM or isolated-vm) behind `Sandbox`.
3. Wire Google OIDC.
4. Deploy: containerize the server; the sandbox needs a host that allows child processes.
