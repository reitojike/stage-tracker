import { spawnSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// A bare shell `>` redirect truncates the committed file before the
// generator even runs, so a mid-generation failure would leave it empty or
// partial. Generate to a temp file first and only replace the committed
// file once generation has actually succeeded.
const committedPath = path.resolve('src/infrastructure/supabase/database.types.ts');
const tempPath = `${committedPath}.tmp`;

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

writeFileSync(tempPath, result.stdout);
renameSync(tempPath, committedPath);
console.log(`Wrote ${committedPath}`);
