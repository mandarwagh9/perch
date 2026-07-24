# Security policy

Perch runs untrusted, agent-generated code, so we take isolation seriously and we are
honest about the boundary's limits.

## What the sandbox guarantees today

- Untrusted app code runs in a `vm.SourceTextModule` with a deny-all import linker and no
  reference to any host-realm object (see `src/sandbox-host.mjs`). It cannot `require`,
  `import`, `fetch`, reach `process`, or `eval`.
- The app process runs under Node's `--permission` model: no filesystem write, no child
  processes, no workers, no native addons. Filesystem **reads** are scoped to the sandbox
  source directory, so an escape cannot read the control-plane database.
- Per-request wall-clock timeout, per-app heap cap, and per-app load shedding.
- Every request is authenticated and authorized by the supervisor before app code runs.

## What it does NOT guarantee (please read before hosting a public instance)

- Node's `vm` is **not** a hostile-multi-tenant security boundary on its own, and Node's
  permission model **does not cover network egress**. A future `vm` escape could in
  principle open an outbound socket. **Do not run a public instance where strangers deploy
  arbitrary code** until the sandbox is backed by V8 isolates / gVisor / Cloudflare
  Workers-for-Platforms (the `Sandbox` interface is designed to be swapped for exactly this).
- The intended deployment is **a single trust domain**: a team self-hosting Perch for its
  own members. That is also the product's target use case.

## Reporting a vulnerability

Please open a private report (GitHub Security Advisory) or email the maintainer rather than
filing a public issue. Include a proof-of-concept if you have one. We aim to acknowledge
within a few days. Because this is a reference implementation, the fastest fixes are usually
to the `Sandbox` adapter; PRs adding a hardened runtime are very welcome.
