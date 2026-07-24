import { Perch } from './perch.ts';

const port = Number(process.env.PORT ?? 8787);
const perch = new Perch({
  dbPath: process.env.PERCH_DB ?? '.perch-data/perch.db',
  secret: process.env.PERCH_SECRET,
  baseUrl: process.env.PERCH_BASE_URL ?? `http://localhost:${port}`,
  allowDevTokens: process.env.PERCH_DEV_TOKENS !== 'false',
});

perch.listen(port).then(({ url }) => {
  // eslint-disable-next-line no-console
  console.log(`Perch listening on ${url}`);
  console.log(`  • recipient UI:   ${url}/my`);
  console.log(`  • deploy API:     POST ${url}/v1/deploy`);
  console.log(`  • dev token:      POST ${url}/v1/auth/dev-token  {"email":"you@acme.com"}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    perch.close().then(() => process.exit(0));
  });
}
