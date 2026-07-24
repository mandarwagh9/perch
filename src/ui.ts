// Perch recipient UI + landing page. Server-rendered, dependency-free HTML/CSS —
// the same no-build ethos as the product. Design language: dark-tech, one locked
// amber accent, one radius system, dark+light via prefers-color-scheme, restrained
// motion honoring prefers-reduced-motion. No em-dashes anywhere (by rule).
import type { AppRecord, User } from './types.ts';

const CSS = `
:root {
  --bg: #0c0d10; --bg-2: #131418; --line: #23252b; --line-2: #2c2f37;
  --fg: #eceef2; --muted: #9a9ca4; --faint: #6b6d75;
  --accent: #e6a93c; --accent-ink: #1a1205;
  --radius: 12px; --radius-pill: 999px;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #fbfaf8; --bg-2: #ffffff; --line: #e7e5e0; --line-2: #dcd9d2;
    --fg: #17171a; --muted: #605f66; --faint: #8a8992; --accent: #a9751a; --accent-ink: #fff; }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans);
  line-height: 1.5; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
a { color: inherit; text-decoration: none; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }

nav { display: flex; align-items: center; justify-content: space-between; height: 64px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(8px); z-index: 10; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 620; letter-spacing: -0.01em; }
.brand svg { display: block; }
.nav-links { display: flex; align-items: center; gap: 22px; font-size: 14px; color: var(--muted); }
.nav-links a:hover { color: var(--fg); }

.btn { display: inline-flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; font-weight: 560;
  border-radius: var(--radius-pill); padding: 10px 18px; border: 1px solid transparent; cursor: pointer; transition: transform .12s ease, background .15s ease, border-color .15s ease; white-space: nowrap; }
.btn:active { transform: translateY(1px); }
.btn-primary { background: var(--accent); color: var(--accent-ink); }
.btn-primary:hover { background: color-mix(in srgb, var(--accent) 88%, #fff); }
.btn-ghost { border-color: var(--line-2); color: var(--fg); background: transparent; }
.btn-ghost:hover { border-color: var(--faint); }
.btn-sm { padding: 7px 13px; font-size: 13px; }

.hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 48px; align-items: center; padding: 88px 0 72px; }
.eyebrow { font-family: var(--mono); font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); margin-bottom: 20px; }
h1.display { font-size: clamp(34px, 5vw, 54px); line-height: 1.04; letter-spacing: -0.025em; font-weight: 640; margin: 0 0 20px; }
.hero p.lede { font-size: 18px; color: var(--muted); max-width: 30ch; margin: 0 0 28px; }
.hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }

.codepanel { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: 0 24px 60px -30px color-mix(in srgb, var(--accent) 22%, #000); }
.codepanel .bar { display: flex; align-items: center; gap: 7px; padding: 12px 14px; border-bottom: 1px solid var(--line); color: var(--faint); font-family: var(--mono); font-size: 12px; }
.codepanel .bar b { width: 10px; height: 10px; border-radius: 50%; background: var(--line-2); }
.codepanel pre { margin: 0; padding: 18px; font-family: var(--mono); font-size: 13px; line-height: 1.7; overflow-x: auto; }
.codepanel .k { color: var(--accent); } .codepanel .c { color: var(--faint); } .codepanel .s { color: #7fb891; }

section.band { padding: 64px 0; border-top: 1px solid var(--line); }
h2.sec { font-size: clamp(24px, 3vw, 32px); letter-spacing: -0.02em; font-weight: 620; margin: 0 0 8px; }
.sec-sub { color: var(--muted); max-width: 60ch; margin: 0 0 40px; }
.problems { display: grid; gap: 0; }
.problem { display: grid; grid-template-columns: 40px 1fr; gap: 20px; padding: 24px 0; border-top: 1px solid var(--line); }
.problem:first-child { border-top: none; }
.problem .n { font-family: var(--mono); color: var(--accent); font-size: 15px; padding-top: 2px; }
.problem h3 { margin: 0 0 6px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.problem p { margin: 0; color: var(--muted); font-size: 15px; max-width: 62ch; }

footer { border-top: 1px solid var(--line); padding: 40px 0; color: var(--faint); font-size: 13px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; }

/* recipient app */
.apphead { padding: 40px 0 24px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.apphead h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0; font-weight: 620; }
.tools { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.tools li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border-top: 1px solid var(--line); }
.tools li:first-child { border-top: none; }
.tools .t-main { min-width: 0; }
.tools .t-name { font-weight: 560; letter-spacing: -0.01em; }
.tools .t-id { font-family: var(--mono); font-size: 12px; color: var(--faint); }
.tools .t-actions { display: flex; gap: 8px; align-items: center; }
.empty { border: 1px dashed var(--line-2); border-radius: var(--radius); padding: 40px; text-align: center; color: var(--muted); }
.tag { font-family: var(--mono); font-size: 11px; color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line)); border-radius: var(--radius-pill); padding: 2px 9px; }

.center { min-height: calc(100dvh - 64px); display: grid; place-items: center; padding: 24px; }
.card { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); padding: 32px; width: 100%; max-width: 400px; }
.card h1 { font-size: 22px; letter-spacing: -0.02em; margin: 0 0 8px; }
.field { display: flex; flex-direction: column; gap: 8px; margin: 20px 0; }
.field label { font-size: 13px; color: var(--muted); }
.field input { font: inherit; font-size: 15px; padding: 11px 13px; border-radius: 10px; border: 1px solid var(--line-2); background: var(--bg); color: var(--fg); }
.field input:focus { outline: none; border-color: var(--accent); }
.share-form { display: flex; gap: 6px; }
.share-form input, .share-form select { font: inherit; font-size: 13px; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line-2); background: var(--bg); color: var(--fg); }

@media (max-width: 820px) { .hero { grid-template-columns: 1fr; gap: 32px; padding: 56px 0 48px; } .hero p.lede { max-width: none; } }

@media (prefers-reduced-motion: no-preference) {
  .reveal { animation: up .6s cubic-bezier(.16,1,.3,1) both; }
  .reveal-2 { animation: up .6s cubic-bezier(.16,1,.3,1) .08s both; }
  @keyframes up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
}
`;

const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 15c5 0 8-3 8-8 0 5 3 8 8 8-5 0-8 3-8 8 0-5-3-8-8-8Z" fill="var(--accent)"/></svg>`;

function page(title: string, body: string, opts: { desc?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(opts.desc ?? 'The cloud where the software your agent builds lands.')}">
<style>${CSS}</style></head><body>${body}</body></html>`;
}

function nav(): string {
  return `<nav><div class="wrap" style="display:flex;align-items:center;justify-content:space-between;width:100%">
    <a class="brand" href="/">${MARK}<span>Perch</span></a>
    <div class="nav-links">
      <a href="/#how">How it works</a>
      <a href="/#problems">What it solves</a>
      <a class="btn btn-ghost btn-sm" href="/my">Your tools</a>
    </div></div></nav>`;
}

export function renderHome(baseUrl: string, note = ''): string {
  const body = `${nav()}<main class="wrap">
    <div class="hero">
      <div class="reveal">
        <div class="eyebrow">Agent-native cloud</div>
        <h1 class="display">The cloud where the software your agent builds lands.</h1>
        <p class="lede">Your agent deploys it in one call. Teammates open it like a Google Doc. Take the code and leave anytime.</p>
        <div class="hero-cta">
          <a class="btn btn-primary" href="/my">Open your tools</a>
          <a class="btn btn-ghost" href="#how">See how it works</a>
        </div>
        ${note ? `<p class="muted" style="margin-top:20px;font-size:14px">${esc(note)}</p>` : ''}
      </div>
      <div class="codepanel reveal-2" aria-hidden="true">
        <div class="bar"><b></b><b></b><b></b><span style="margin-left:6px">agent session</span></div>
<pre><span class="c"># the agent calls Perch while it builds</span>
<span class="k">perch_deploy</span>({
  name: <span class="s">"expense-splitter"</span>,
  code: <span class="s">"export default handler..."</span>
})
<span class="c">→ https://perch/a/expense-splitter-8f2a</span>
<span class="c">  private by default. share it:</span>
<span class="k">perch_share</span>(id, <span class="s">"org:acme.com"</span>, <span class="s">"user"</span>)</pre>
      </div>
    </div>
  </main>

  <section class="band" id="problems"><div class="wrap">
    <h2 class="sec">Three hard problems, answered in the platform</h2>
    <p class="sec-sub">Building small tools got easy. Deploying, securing, and sharing them did not. Perch takes those on so the agent does not have to.</p>
    <div class="problems">
      <div class="problem"><div class="n">01</div><div><h3>Runs arbitrary code, safely</h3><p>Every tool executes in a locked-down sandbox with no filesystem, network, or host access. Its only capability is its own isolated storage, handed in by the platform.</p></div></div>
      <div class="problem"><div class="n">02</div><div><h3>Auth and permissions, built in</h3><p>Tools inherit your org identity. The platform authorizes every request before a line of tool code runs. Share by person, group, org, or public.</p></div></div>
      <div class="problem"><div class="n">03</div><div><h3>Shared like a doc, owned like a file</h3><p>Send a link the way you send a Google Doc. And eject the exact source to a zip whenever you want. No lock-in, ever.</p></div></div>
    </div>
  </div></section>

  <section class="band" id="how"><div class="wrap">
    <h2 class="sec">Built for the agent, not the dashboard</h2>
    <p class="sec-sub">Perch exposes a small API over MCP and a CLI. The agent deploys the software it just wrote, gets a URL back, and shares it. No human clicks a deploy button.</p>
    <div class="codepanel"><div class="bar"><b></b><b></b><b></b><span style="margin-left:6px">terminal</span></div>
<pre><span class="c"># or drive it yourself from the terminal</span>
$ <span class="k">perch</span> deploy ./expense-splitter
  deployed: expense-splitter
  url:   ${esc(baseUrl)}/a/expense-splitter-8f2a
$ <span class="k">perch</span> share expense-splitter-8f2a org:acme.com user
$ <span class="k">perch</span> eject expense-splitter-8f2a   <span class="c"># your code, portable</span></pre>
    </div>
  </div></section>

  <footer><div class="wrap" style="display:flex;justify-content:space-between;width:100%;flex-wrap:wrap;gap:16px">
    <span>${MARK} Perch. A reference implementation.</span>
    <span class="mono">deploy · share · eject</span>
  </div></footer>`;
  return page('Perch', body);
}

export function renderMyTools(user: User, apps: AppRecord[]): string {
  const items = apps.length
    ? apps
        .map((a) => {
          const owned = a.ownerEmail === user.email;
          return `<li><div class="t-main">
            <div class="t-name">${esc(a.name)} ${owned ? '<span class="tag">owner</span>' : ''}</div>
            <div class="t-id">${esc(a.id)}</div>
          </div><div class="t-actions">
            ${owned ? shareForm(a.id) : ''}
            <a class="btn btn-ghost btn-sm" href="/a/${esc(a.id)}">Open</a>
          </div></li>`;
        })
        .join('')
    : '';
  const list = apps.length
    ? `<ul class="tools">${items}</ul>`
    : `<div class="empty">No tools yet. When an agent deploys one to you, it shows up here.</div>`;
  const body = `${nav()}<main class="wrap">
    <div class="apphead"><h1>Your tools</h1><div class="muted mono" style="font-size:13px">${esc(user.email)}</div></div>
    ${list}
  </main>
  <script>
  async function share(e, id){ e.preventDefault();
    const f = e.target; const principal = f.principal.value.trim(); const role = f.role.value;
    if(!principal) return;
    const r = await fetch('/v1/apps/'+id+'/share', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({principal, role}) });
    f.querySelector('button').textContent = r.ok ? 'shared' : 'error';
    setTimeout(()=>{ f.querySelector('button').textContent = 'Share'; }, 1400);
  }
  </script>`;
  return page('Your tools · Perch', body);
}

function shareForm(id: string): string {
  return `<form class="share-form" onsubmit="share(event,'${esc(id)}')">
    <input name="principal" placeholder="org:acme.com" aria-label="who to share with" size="14" />
    <select name="role" aria-label="role"><option value="user">use</option><option value="viewer">view</option><option value="editor">edit</option></select>
    <button class="btn btn-ghost btn-sm" type="submit">Share</button>
  </form>`;
}

export function renderSignin(next: string, note = ''): string {
  const body = `${nav()}<main class="center"><div class="card">
    <h1>Sign in</h1>
    <p class="muted" style="margin:0;font-size:14px">Dev mode. Enter any work email to get a session.</p>
    ${note ? `<p style="color:var(--accent);font-size:13px">${esc(note)}</p>` : ''}
    <form method="POST" action="/signin">
      <input type="hidden" name="next" value="${esc(next)}" />
      <div class="field"><label for="email">Work email</label>
        <input id="email" name="email" type="email" placeholder="you@acme.com" required autofocus /></div>
      <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Continue</button>
    </form>
  </div></main>`;
  return page('Sign in · Perch', body);
}

export function renderAppFrame(appId: string, baseUrl: string): string {
  const body = `${nav()}<main class="center"><div class="card">
    <h1>This tool is private</h1>
    <p class="muted" style="font-size:14px">Sign in to open <span class="mono">${esc(appId)}</span>. You will only see it if it has been shared with you.</p>
    <a class="btn btn-primary" href="/signin?next=${encodeURIComponent('/a/' + appId)}" style="width:100%;justify-content:center;margin-top:8px">Sign in</a>
  </div></main>`;
  return page('Sign in · Perch', body);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
