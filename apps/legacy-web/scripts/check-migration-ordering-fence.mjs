import { spawnSync } from 'node:child_process';
import {
  parseAddedMigrationFiles,
  evaluateMigrationOrderingFence,
} from './lib/migrationOrderingFence.mjs';

// CI-only pre-merge gate (Issue #131): for any PR that adds a
// supabase/migrations/**.sql file, the PR body must explicitly record
// whether Production needs the migration applied before merge
// ("schema-first-required") or whether it's safe to merge/deploy first
// ("post-deploy-safe"), per docs/architecture/runtime-stack.md "デプロイ・
// 実行経路". This cannot verify that Production was actually migrated - CI
// has no Production credentials by design (see runtime-stack.md
// "Environment Variables の所有境界") - it only prevents the ordering
// judgment from being silently skipped, which is what let #121/#124/#125
// ship without it.
//
// Requires BASE_SHA / HEAD_SHA / PR_BODY in the environment (wired from the
// pull_request event in .github/workflows/verify.yml) and a full-history
// checkout (fetch-depth: 0) so the base commit is resolvable.

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;
const prBody = process.env.PR_BODY ?? '';

if (typeof baseSha !== 'string' || baseSha.length === 0) {
  console.error('BASE_SHA is not set. This check only runs for pull_request events.');
  process.exitCode = 1;
  process.exit();
}
if (typeof headSha !== 'string' || headSha.length === 0) {
  console.error('HEAD_SHA is not set. This check only runs for pull_request events.');
  process.exitCode = 1;
  process.exit();
}

const diffResult = spawnSync(
  'git',
  ['diff', '--name-only', '--diff-filter=A', baseSha, headSha, '--', 'supabase/migrations'],
  { encoding: 'utf8' },
);

if (diffResult.status !== 0) {
  console.error(`Failed to diff ${baseSha}..${headSha} for supabase/migrations.`);
  console.error(diffResult.stderr);
  process.exitCode = 1;
  process.exit();
}

const addedMigrationFiles = parseAddedMigrationFiles(diffResult.stdout);
const { ok, reason } = evaluateMigrationOrderingFence({ addedMigrationFiles, prBody });

if (addedMigrationFiles.length > 0) {
  console.log('Added migration file(s):');
  for (const file of addedMigrationFiles) console.log(`  - ${file}`);
}

if (!ok) {
  console.error(reason);
  process.exitCode = 1;
  process.exit();
}

console.log(reason);
