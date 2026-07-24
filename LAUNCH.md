# Launch notes (draft — not yet posted)

Draft copy for the public launch. Nothing here is posted; pull the trigger when ready.

## Show HN title options

1. Show HN: Perch — an agent-native cloud for small software (self-hosted, MIT)
2. Show HN: Perch — your agent deploys the tool it built, you share it like a Google Doc
3. Show HN: Perch — a tiny cloud where AI-built internal tools land, run sandboxed, and eject to source

## Show HN body (draft)

Perch is a small, self-hosted cloud for the throwaway internal tools your coding agent now
builds in seconds. The twist: the **agent** is the user. It deploys over MCP or a CLI, gets
a URL back, and shares it with your team the way you share a Google Doc. Tools run
sandboxed with their own isolated storage, are private by default, and can eject to source
at any time (no lock-in).

It came out of exploring YC's Fall 2026 RFS "A Cloud for Small Software." Building small
tools got easy; deploying, securing, and sharing them did not. Perch takes those three on:

- Runs arbitrary code safely: a locked-down vm sandbox, no fs/network/host access, only its
  own storage capability. (It survived an adversarial review that found a real escape,
  which is fixed and regression-tested — writeup in the repo.)
- Auth and permissions built in: tools inherit org identity; the supervisor authorizes
  every request before app code runs; share by person, group, org, or public.
- Owned like a file: eject the exact source to a zip whenever you want.

It's a reference implementation (Node 22 + TypeScript, zero runtime framework, 74 tests). I
was honest in SECURITY.md about the boundary: Node's `vm` isn't a hostile-multi-tenant
guarantee, so run it in a single trust domain (your team) for now; the `Sandbox` interface
is built to swap in isolated-vm / Workers-for-Platforms for a public instance.

Repo: <link>. Demo: `npm run demo` plays the whole thing in one narrated run. Would love
feedback on the sandbox design and on whether the "agent deploys, human shares" shape is
the right one.

## What I want feedback on

- Is the sandbox model sound? (SECURITY.md is deliberately honest about the limits.)
- Does "the agent is the user of the cloud" resonate, or is the human-share flow the hook?
- What would make you self-host this for your team?

## Where to post

- Hacker News (Show HN), tied to the RFS moment.
- The relevant agent-tooling communities (MCP directory, Claude/Cursor tool lists).
- X thread with the 40-second demo recording.

## The one metric that matters

Not stars. Watch `/v1/stats`: does anyone deploy a **second** tool, and does a tool get
**shared** with a real teammate. Those are the aha moments.
