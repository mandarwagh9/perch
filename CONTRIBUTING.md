# Contributing to Perch

Thanks for helping build the cloud where agent-built software lands.

## Getting set up

```bash
git clone <your-fork>
cd perch
npm install
npm test        # 74 tests
npm run demo    # see the whole thing work
npm run dev     # local server on :8787
```

Requires Node 22+ (Perch uses the built-in `node:sqlite`).

## Ground rules

- **Tests come with the change.** Every module here was built test-first with `node:test`.
  A behavior change without a test will be asked to add one. Security-relevant changes
  (anything touching `src/sandbox*`, `src/supervisor.ts`, `src/permissions.ts`,
  `src/perch.ts` routing) need a test that would fail without the fix.
- **`npm test` and `npx tsc --noEmit` must be green** before you open a PR.
- **Keep modules deep and interfaces narrow.** Each file has one job; if a file is growing
  a second responsibility, that is a signal to split it. See
  `docs/superpowers/specs/2026-07-24-perch-design.md` for the intended shape.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).

## License of contributions

Perch is source-available under the PolyForm Noncommercial license, not an OSI open-source
license. By contributing, you agree your contribution is provided under that same license and
that the maintainer may also license the project (including your contribution) commercially,
for example as the hosted service. If that is not something you want, please do not submit a
contribution.

## The highest-value contributions right now

1. **A hardened `Sandbox` adapter** (isolated-vm, QuickJS-WASM, or Cloudflare
   Workers-for-Platforms) implementing the `Sandbox` interface in `src/sandbox.ts`. This is
   the one change that would make a public multi-tenant instance safe. See `SECURITY.md`.
2. **A real `AuthProvider`** (Google OIDC) behind the interface in `src/auth.ts`.
3. **Per-app origins** (subdomain routing) so app HTML gets true origin isolation.

## Architecture at a glance

`STATE.md` and the design spec are the fastest way in. The short version: an agent deploys
via `/v1/deploy` (MCP/CLI), the supervisor authorizes every `/a/:appId` request, and the
sandbox runs the tool with a scoped storage capability. Five deep modules, each with a test
file of the same name.
