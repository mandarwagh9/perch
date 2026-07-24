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
  trustedProxyHeader: process.env.PERCH_TRUSTED_PROXY_HEADER,
});

perch.listen(port).then(({ url }) => {
  // eslint-disable-next-line no-console
  const log = console.log;
  log(`Perch listening on ${url}`);
  log(`  • recipient UI:   ${url}/my`);
  log(`  • deploy API:     POST ${url}/v1/deploy`);
  if (allowDevTokens) {
    log(`  • dev token:      POST ${url}/v1/auth/dev-token  {"email":"you@acme.com"}`);
    log('  ⚠ dev-token endpoint is ENABLED (mints a session for any email). Local use only; set PERCH_DEV_TOKENS=false to disable.');
  } else {
    log('  • auth:           dev tokens OFF. Set PERCH_TRUSTED_PROXY_HEADER for SSO, or PERCH_DEV_TOKENS=true for a trusted team.');
  }
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    perch.close().then(() => process.exit(0));
  });
}
