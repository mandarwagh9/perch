// Minimal recipient UI. Polished with the design-taste skill in a later pass; this
// version is intentionally plain but functional so the server is testable end to end.
import type { AppRecord, User } from './types.ts';

const shell = (title: string, body: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#111">
${body}
</body></html>`;

export function renderHome(baseUrl: string, note = ''): string {
  return shell(
    'Perch',
    `<h1>Perch</h1>
     <p>The cloud where the software your agent builds lands — deployed by the agent, shared like a Google Doc, portable like a file.</p>
     ${note ? `<p><em>${esc(note)}</em></p>` : ''}
     <p><a href="/my">My tools →</a></p>`,
  );
}

export function renderMyTools(user: User, apps: AppRecord[]): string {
  const rows = apps.length
    ? apps.map((a) => `<li><a href="/a/${a.id}">${esc(a.name)}</a> <small style="color:#666">${esc(a.id)}</small></li>`).join('')
    : '<li><em>No tools shared with you yet.</em></li>';
  return shell('My tools · Perch', `<h1>My tools</h1><p>Signed in as ${esc(user.email)}</p><ul>${rows}</ul>`);
}

export function renderAppFrame(appId: string, baseUrl: string): string {
  return shell(
    'Sign in · Perch',
    `<h1>Sign in to open this tool</h1>
     <p>This Perch tool (<code>${esc(appId)}</code>) is private. Sign in to continue.</p>
     <p><small>Dev: get a token via <code>POST ${esc(baseUrl)}/v1/auth/dev-token</code>.</small></p>`,
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
