// A tiny team standup logger. Anyone shared in can POST an update; GET shows the log.
export default async function handler(req, ctx) {
  if (req.method === 'POST') {
    const entries = JSON.parse(await ctx.store.get('entries') || '[]');
    entries.push({ who: ctx.user?.email ?? 'anon', text: req.body ?? '', at: new Date().toISOString() });
    await ctx.store.set('entries', JSON.stringify(entries.slice(-100)));
    return { json: { ok: true, count: entries.length } };
  }
  const entries = JSON.parse(await ctx.store.get('entries') || '[]');
  const rows = entries.map(e => `<li><b>${e.who}</b>: ${e.text}</li>`).join('');
  return `<!doctype html><meta charset=utf-8><h1>Standup</h1><ul>${rows || '<i>nothing yet</i>'}</ul>`;
}
