import { spawnSync } from 'node:child_process';
import {
  parseAddedMigrationFiles,
  evaluateMigrationOrderingFence,
} from './lib/migrationOrderingFence.mjs';

// CI-only pre-merge gate (Issue #131, vocabulary revised by #393): for any
// PR that adds a supabase/migrations/**.sql file, the PR body must
// explicitly record whether the migration only adds/relaxes ("additive") or
// changes a value/shape that already-deployed code reads
// ("runtime-first-required" - which also requires a "Runtime dependency
// deployed: <evidence>" line - merging the dependency is not enough, since
// Vercel's deploy is asynchronous), per docs/architecture/runtime-stack.md
// "デプロイ・実行経路" and docs/v2/decisions.md "A8 追補". This cannot verify
// that the declared runtime dependency was actually deployed first - this
// job has no Production credentials by design (see runtime-stack.md
// "Environment Variables の所有境界") - it only prevents the ordering
// judgment from being silently skipped, which is what let #121/#124/#125
// ship without it, and what let #389 declare the wrong (now-retired)
// direction.
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
  // **three-dot（merge-base 起点）で取る。** two-dot だと branch を切ってから
  // main 側が進んだぶんが混ざる。実測では、main が既にその migration を
  // 持っている場合に two-dot が **追加を 1 件も検出せず**、この fence 自体が
  // 「該当なし」で素通りした（PR #396 で artifact fence 側を直したのと同じ原因）。
  [
    'diff',
    '--name-only',
    '-z',
    // rename 検出が効いていると、migration を別 directory へ移した PR で
    // 追加が観測されない。delete + add として扱う（PR #396 で実測）。
    '--no-renames',
    '--diff-filter=A',
    `${baseSha}...${headSha}`,
    '--',
    'supabase/migrations',
  ],
  { encoding: 'utf8' },
);

if (diffResult.status !== 0) {
  console.error(`Failed to diff ${baseSha}...${headSha} for supabase/migrations.`);
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
