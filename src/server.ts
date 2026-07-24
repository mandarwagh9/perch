import { Perch } from './perch.ts';

const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.PERCH_BASE_URL ?? `http://localhost:${port}`;
// Auto-enable the dev-token endpoint only for a localhost base URL (never when exposed),
// unless explicitly forced. It mints a session for any email, so this stays local-only.
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(baseUrl);
const allowDevTokens = process.env.PERCH_DEV_TOKENS === 'true' || (isLocal && process.env.PERCH_DEV_TOKENS !== 'false');

const perch = new Perch({
  dbPath: process.env.PERCH_DB ?? '.perch-data/perch.db',
  secret: process.env.PERCH_SECRET,
  baseUrl,
  allowDevTokens,
});

perch.listen(port).then(({ url }) => {
  // eslint-disable-next-line no-console
  console.log(`Perch listening on ${url}`);
  if (allowDevTokens) console.log('  ⚠ dev-token endpoint is ENABLED (local only). Set PERCH_DEV_TOKENS=false to disable.');
  console.log(`  • recipient UI:   ${url}/my`);
  console.log(`  • deploy API:     POST ${url}/v1/deploy`);
  console.log(`  • dev token:      POST ${url}/v1/auth/dev-token  {"email":"you@acme.com"}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    perch.close().then(() => process.exit(0));
  });
}
