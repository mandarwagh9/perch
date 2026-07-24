# Perch

**The cloud where the software your agent builds lands.** Deployed by the agent in one call, shared like a Google Doc, portable like a file.

**Website:** [mandarwagh9.github.io/perch](https://mandarwagh9.github.io/perch/) · **License:** MIT · **Status:** reference implementation, 77 tests

Perch is a working reference implementation of an *agent-native* cloud for small software. It takes YC's Fall 2026 RFS "A Cloud for Small Software" (Pete Koomen) one step further: the primary user is the **agent** building the software, not a human clicking a deploy button. When an agent finishes a small tool, it calls Perch (over MCP or a CLI), gets back a shareable, permissioned URL, and moves on.

It answers the three hard sub-problems the RFS names, in the platform itself:

1. **Runs arbitrary code safely.** Every tool executes in a locked-down sandbox with no filesystem, network, or host access. Its only capability is its own isolated storage, handed in by the platform.
2. **Auth and permissions, built in.** Tools inherit org identity. The supervisor authorizes every request *before* a line of tool code runs. Share by person, group, org, or public.
3. **Shared like a doc, owned like a file.** Send a link the way you send a Google Doc, and eject the exact source to a `.zip` any time. No lock-in.

## Quickstart

```bash
npm install
npm test        # 67 tests, incl. sandbox-escape and authorization tests
npm run demo    # narrated end-to-end proof of the whole thesis
npm run dev     # start the server on :8787
```

`npm run demo` plays the full story in-process: an agent deploys a tool, an outsider is refused, it is shared org-wide, a teammate uses it with isolated persistent storage, a second tool cannot see the first's data, a hostile tool is contained, and the source ejects to a real zip.

## How an agent uses it

**Over MCP** (the point of Perch). Point the MCP server at a running Perch and the agent gets 6 tools: `perch_deploy`, `perch_list`, `perch_share`, `perch_logs`, `perch_source`, `perch_dev_token`. Get the one-line setup for your agent:

```bash
npm run cli -- mcp-install     # prints the `claude mcp add ...` command + a config block
```

```jsonc
// what it installs, in an MCP client (Claude Code, Cursor, ...) config
{ "mcpServers": { "perch": { "command": "npx", "args": ["tsx", "src/mcp.ts"], "env": { "PERCH_URL": "http://localhost:8787" } } } }
```

**Over the CLI:**

```bash
perch token you@acme.com                 # get a session
perch deploy ./my-tool                   # deploy a dir or a single file
perch share <appId> org:acme.com user    # share it
perch logs <appId>                        # debug what you shipped
perch eject <appId>                       # take the source and leave
```

**Over HTTP:** `POST /v1/deploy` with `{ manifest, files }`, then `/a/:appId/*` is the running tool.

## Self-host it for your team

Perch is meant to run in **one trust domain**: your team hosts it for its own members. That
is both the safe way to run it (see security note) and the product's target use case.

```bash
docker build -t perch .
docker run -p 8787:8787 \
  -e PERCH_BASE_URL=https://tools.yourco.com \
  -e PERCH_SECRET=$(openssl rand -hex 24) \
  -e PERCH_TRUSTED_PROXY_HEADER=x-forwarded-email \
  -v perch-data:/app/.perch-data \
  perch
```

The sandbox forks child processes, so host it on a real container/VM platform (Cloud Run,
Fly, Render, a VM) — not a function/edge runtime.

**Auth options** (dev tokens are OFF by default when the base URL is not localhost):
- **SSO (recommended):** put Perch behind Cloudflare Access, Google IAP, or oauth2-proxy and
  set `PERCH_TRUSTED_PROXY_HEADER` to the header they inject (e.g. `x-forwarded-email`). The
  proxy authenticates; Perch trusts that header. (Make sure the proxy strips client-supplied
  copies of it.)
- **Trusted team, no proxy:** set `PERCH_DEV_TOKENS=true` to enable email-token sign-in.
- **Real OIDC:** implement the `AuthProvider` interface in `src/auth.ts` (Google OIDC is a
  small drop-in).

`GET /v1/stats` reports aggregate, no-PII usage (deploys, redeploys, shares, runs, ejects,
apps) — watch repeat-deploys and shares, the two signals that mean people actually want it.

## What an app looks like

An app is one module that default-exports a handler. `ctx.store` is its private key-value storage; `ctx.user` is the signed-in viewer. It cannot import anything, touch the filesystem, or open the network.

```js
export default async function handler(request, ctx) {
  const n = Number(await ctx.store.get('count') ?? 0) + 1;
  await ctx.store.set('count', String(n));
  return { json: { count: n, by: ctx.user?.email ?? 'anon' } };
}
```

## Architecture

Five deep modules with narrow interfaces (full design in `docs/superpowers/specs/2026-07-24-perch-design.md`):

| Module | File | Responsibility |
|---|---|---|
| **Store** | `src/store.ts` | Control-plane state + one isolated SQLite storage facet per app. |
| **Sandbox** | `src/sandbox.ts` + `sandbox-host.mjs` | Runs untrusted code in a `vm.SourceTextModule` inside a child launched with Node's `--permission` model. Scale-to-zero pool, idle-kill, wall-clock timeout. |
| **Supervisor** | `src/supervisor.ts` | The front door: auth -> authorize -> rate-limit, *then* forward into the sandbox with a scoped `ctx`. |
| **Deploy** | `src/deploy.ts` | Bundle validation with machine-readable errors; in-place redeploy. |
| **Agent interface** | `src/cli.ts`, `src/mcp.ts`, `src/tools.ts` | The CLI and MCP surface an agent drives. |

```
agent (MCP/CLI) ─▶ Control plane (/v1/deploy, /share, /eject)
human ─▶ /a/:appId ─▶ Supervisor (auth+authz+ratelimit) ─▶ Sandbox (scoped ctx) ─▶ app
                                     │                              │
                                     └──────── Store (per-app isolated facets) ───────┘
```

### The graveyard lessons, answered in the architecture

- **Glitch** died on always-on container-per-app economics: Perch is **scale-to-zero** (cold by default, idle-killed, zero idle cost).
- **Heroku** killed its free tier on abuse: Perch is **auth-gated by construction** (no anonymous compute).
- **Darklang** died on proprietary-editor lock-in: Perch apps are **plain portable code**, authored in the agent's own tools.
- **Airplane** stranded customers: **eject-to-source** is a first-class primitive, always available.

## Security posture (honest)

The untrusted-code boundary is **defense in depth**, and it was adversarially reviewed (the review found a real vm-escape via injected-object constructors, now fixed and regression-tested):

- **Realm isolation.** The app can never hold a reference to a host-realm object. `console`, `ctx`, and `request` are built *inside* the vm context by a trusted bootstrap that then erases its host bridges from the global; all data crosses as JSON primitives. With `codeGeneration.strings:false`, the context's own `Function`/`eval` are dead, so `ctx.store.get.constructor('return process')()` throws. (Tested: `test/sandbox.test.ts` "cannot escape the vm ... via injected-object constructors".)
- **Deny-all imports** (`vm.SourceTextModule` linker) and no `require`/`fetch`/`process`/`Buffer` in the context.
- **Process containment** under Node's `--permission` model: no filesystem write, no child processes, no workers, no native addons, and reads scoped to the sandbox source dir — so even a hypothetical escape cannot read the control-plane DB (which lives under `.perch-data/`).
- **Load-shedding, timeout, heap cap** per app; the app's only I/O is an async capability bridge to *its own* storage facet.

**What this is not:** Node's `vm` is still not a hostile-multi-tenant guarantee, and Node's permission model does not cover network egress, so a future escape could in principle still open a socket. The `Sandbox` interface is swappable: production drops in V8 isolates, gVisor, or Cloudflare Workers-for-Platforms (which *can* deny egress) behind the same interface. Stated plainly so the boundary is not overclaimed. Also hardened per review: deploy requires an authenticated principal (owner is derived from the token, never the body), app responses are served with a sandboxing CSP and cannot set cookies, the rate-limiter keys on the trusted socket IP, admin tokens compare in constant time, and deploy rejects path-traversal file paths.

## Status

Reference implementation. Node 22+ (uses built-in `node:sqlite`). Not built: billing, real OAuth (there is a pluggable auth seam with a dev email-token provider and a trusted-proxy provider), custom domains, multi-node scaling. Each is a named seam in the spec, not a hidden gap.

## Contributing & license

Contributions welcome, especially a hardened `Sandbox` adapter or a real OIDC provider. See
[CONTRIBUTING.md](CONTRIBUTING.md). Please read [SECURITY.md](SECURITY.md) before hosting a
public instance. MIT licensed ([LICENSE](LICENSE)).
