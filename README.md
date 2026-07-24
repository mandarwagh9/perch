<div align="center">

# Perch

**The cloud where the software your agent builds lands.**

Your agent deploys the tool it just built in one call. Your team opens it like a Google Doc.
It runs sandboxed, and you can take the source and leave anytime.

[**Website**](https://mandarwagh9.github.io/perch/) · [Get access](https://mandarwagh9.github.io/perch/#access) · [How it works](#how-it-works) · [Self-evaluate](#run-it-locally)

Source-available · Noncommercial license · Commercial use via the hosted service

</div>

---

## What it is

Perch is an **agent-native cloud for small software** — the throwaway internal tools your
coding agent now builds in seconds. The twist: the **agent** is the user of the cloud, not a
human clicking a deploy button. When an agent finishes a tool, it calls Perch (over MCP or a
CLI), gets back a shareable, permissioned URL, and moves on.

It solves the three things that stay hard after the code is written:

- **Run arbitrary code safely.** Every tool runs in a locked-down sandbox with no filesystem,
  network, or host access. Its only capability is its own isolated storage, handed in by the
  platform. It shipped with an adversarial security review that found a real escape, now fixed
  and regression-tested.
- **Auth and permissions, built in.** Tools inherit your org identity. The supervisor
  authorizes every request before a line of tool code runs. Share by person, group, org, or
  public. Works behind your SSO with one setting.
- **Shared like a doc, owned like a file.** Send a link the way you send a Google Doc, and
  eject the exact source to a zip whenever you want. No lock-in.

## Perch as a service (recommended)

The fastest way to use Perch is the **hosted service**: we run it for your team, keep the
sandbox hardened, handle SSO and upgrades, and you just share tools.

> **[Get access →](https://mandarwagh9.github.io/perch/#access)**

| | Hosted Perch | Self-evaluate (source) |
|---|---|---|
| Setup | none, we run it | clone and run locally |
| Sandbox hardening | managed | reference (see [SECURITY.md](SECURITY.md)) |
| SSO / identity | included | bring your own proxy |
| Upgrades & support | included | you maintain it |
| License | commercial | noncommercial only |

Commercial use — running Perch for a company or team, or offering it to others — is available
through the hosted service or a commercial license. See [Licensing](#licensing).

## Run it locally

For personal, noncommercial evaluation:

```bash
npm install
npm run demo    # narrated end-to-end: agent deploys, it runs sandboxed, gets shared, ejects
npm test        # the test suite, including the sandbox-escape and authorization tests
npm run dev     # local server on :8787, recipient UI at /my
```

Requires Node 22+ (uses the built-in `node:sqlite`).

## How an agent uses it

Point the MCP server at a running Perch and your agent gets six tools: `perch_deploy`,
`perch_list`, `perch_share`, `perch_logs`, `perch_source`, `perch_dev_token`. Get the setup:

```bash
npm run cli -- mcp-install     # prints the setup for Claude Code / Cursor
```

A tool is one module that default-exports a handler. `ctx.store` is its private storage;
`ctx.user` is the signed-in viewer. It cannot import anything, touch the filesystem, or open
the network.

```js
export default async function handler(request, ctx) {
  const n = Number(await ctx.store.get('count') ?? 0) + 1;
  await ctx.store.set('count', String(n));
  return { json: { count: n, by: ctx.user?.email ?? 'anon' } };
}
```

## How it works

```
agent (MCP/CLI) ─▶ Control plane (/v1/deploy, /share, /eject)
human ─▶ /a/:appId ─▶ Supervisor (auth + authz + rate-limit) ─▶ Sandbox (scoped ctx) ─▶ tool
                                   │                                    │
                                   └──────── Store (per-app isolated storage) ────────┘
```

Five focused modules, each with a matching test file: `store.ts` (per-app isolated SQLite),
`sandbox.ts` + `sandbox-host.mjs` (the untrusted-code runtime), `supervisor.ts` (the auth
front door), `deploy.ts` (bundle validation), and the agent interface (`cli.ts`, `mcp.ts`).

## Security

Perch runs untrusted code, and [SECURITY.md](SECURITY.md) is honest about the boundary: run
it in a single trust domain (your team). The hosted service is where the harder
multi-tenant isolation lives. Please read it before hosting your own instance.

## Licensing

Source-available under the **PolyForm Noncommercial 1.0.0** license ([LICENSE](LICENSE)): free
for personal and noncommercial evaluation. **Any commercial use** — running Perch for a
company or team, or offering it to others as a service — requires the hosted service or a
commercial license. [Get in touch](https://mandarwagh9.github.io/perch/#access).

This is not an open-source (OSI) license, and Perch is not free for commercial use.
