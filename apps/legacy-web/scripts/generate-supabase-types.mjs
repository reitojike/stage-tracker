import { spawnSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A bare shell `>` redirect truncates the committed file before the
// generator even runs, so a mid-generation failure would leave it empty or
// partial. Generate to a temp file first and only replace the committed
// file once generation has actually succeeded.
// Monorepo layout: this script is invoked with the repository root as cwd
// (see root package.json's supabase:types, which must stay root-rooted so
// `supabase gen types` resolves supabase/config.toml), while the generated
// file itself lives under this app package.
// Two committed copies, byte-identical. apps/web cannot import the
// legacy-web one: its ESLint boundary (apps/web/eslint.config.mjs) forbids
// every import from apps/legacy-web, which is what keeps the v2 rewrite
// oracle-driven. Writing the generator output to both paths keeps the
// duplication mechanical rather than hand-synced; check-supabase-types-drift.mjs
// verifies both. The duplication disappears when legacy-web is removed at
// cutover (docs/v2/decisions.md).
const committedPaths = [
  path.resolve('apps/legacy-web/src/infrastructure/supabase/database.types.ts'),
  path.resolve('apps/web/src/lib/data/database.types.ts'),
];

// Windows can only launch node_modules/.bin's supabase.cmd shim through a
// shell (Node throws EINVAL otherwise); the args below are static literals,
// not external input, so shell:true carries no injection risk here.
const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', '--local', '--schema', 'public'],
  { encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.status !== 0) {
  console.error('Failed to generate Supabase types from the local database.');
  console.error(result.stderr);
  process.exitCode = 1;
  process.exit();
}

for (const committedPath of committedPaths) {
  const tempPath = `${committedPath}.tmp`;
  writeFileSync(tempPath, result.stdout);
  renameSync(tempPath, committedPath);
  console.log(`Wrote ${committedPath}`);
}
