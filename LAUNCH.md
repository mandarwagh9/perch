# Launch notes (draft — not posted)

Draft copy for the public launch of Perch as a hosted service with source-available code.
Nothing here is posted; pull the trigger when ready.

## Positioning

Perch is an agent-native cloud for small software. The agent deploys the tool it built, your
team opens it like a Google Doc, it runs sandboxed, and it can eject to source. Sold as a
**hosted service** for teams; the source is available to read and evaluate (noncommercial).

## Title options

1. Perch — the cloud where the software your agent builds lands
2. Perch — your agent deploys the tool it built, your team opens it like a Google Doc
3. Perch — a place for AI-built internal tools to run, be shared, and stay yours

## Short post (draft)

Perch is a small cloud for the throwaway internal tools your coding agent now builds in
seconds. The twist: the agent is the user. It deploys over MCP or a CLI, gets a URL back, and
shares it with your team the way you share a Google Doc. Tools run sandboxed with their own
isolated storage, are private by default, and can export to source anytime.

It takes on the three things that stay hard after the code is written: running untrusted code
safely, auth and permissions, and getting a tool to a teammate without friction. It shipped
with an adversarial security review that found a real sandbox escape, now fixed and tested
against. We are direct about the boundary in SECURITY.md rather than overclaiming it.

We run it for teams as a hosted service (managed isolation, SSO, support). The source is
available to read and self-evaluate under a noncommercial license.

Site: <link>. Get access: <link>.

## What to ask for feedback on

- Does "the agent is the user of the cloud" land, or is the human-share flow the hook?
- What would make you want this hosted for your team?

## Where to post

- Hacker News, the agent-tooling communities (MCP directories, Claude/Cursor tool lists), and
  an X thread with a short demo recording.

## The metric that matters

Not stars. Watch access requests, and once teams are on: repeat deploys and real shares.
