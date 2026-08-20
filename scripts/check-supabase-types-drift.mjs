import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Generated Supabase types are a mechanical artifact; the local migrations
// applied to the running Supabase database are the semantic source of
// truth. This regenerates from that running database and fails non-zero on
// any byte-exact diff against the committed file, so drift can never be
// silently merged.
const committedPath = path.resolve('src/infrastructure/supabase/database.types.ts');

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

const generated = result.stdout;

let committed;
try {
  committed = readFileSync(committedPath, 'utf8');
} catch {
  console.error(
    `Committed generated types file not found at ${committedPath}. Run "npm run supabase:types" first.`,
  );
  process.exitCode = 1;
  process.exit();
}

if (generated !== committed) {
  console.error(
    `Generated Supabase types differ from ${committedPath}.\n` +
      'Run "npm run supabase:types" and commit the diff.',
  );
  process.exitCode = 1;
  process.exit();
}

console.log('Generated Supabase types match the local schema exactly.');
