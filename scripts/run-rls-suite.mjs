import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Issue #209: migrationDataPreservation.test.ts and eventRangeBackfill.test.ts
// replay committed migration SQL - including a `create table ... references
// auth.users(id)` - directly against raw pg connections in an isolated
// scratch schema. Creating that foreign key takes a lock on auth.users that
// can conflict with other test/rls/*.test.ts files' concurrent
// createTestActor/deleteTestActor churn on the same table, which Node's
// test runner exposes by default (every file here runs in parallel) as an
// observed, reproducible Postgres deadlock (SQLSTATE 40P01 - see
// test/rls/support/deadlockRetry.ts).
//
// Rather than serializing the whole RLS suite (`--test-concurrency=1` for
// every file), only these two migration-replay files are run afterward, on
// their own and one at a time, once every other file (and its auth.users
// churn) has finished. Ordinary RLS tests keep Node's default parallelism.
//
// This enumerates test/rls/*.test.ts and *.test.mjs directly with `fs`
// rather than relying on shell glob expansion/exclusion so behavior stays
// identical on Windows (cmd.exe/PowerShell do not glob-expand `*` the way a
// POSIX shell does) and on CI's bash - see docs/runbooks and Issue #209 for
// the constraint that local Windows verification must not depend on
// shell-specific glob/filter tricks.
const RLS_DIR = 'test/rls';

const MIGRATION_REPLAY_FILES = [
  'migrationDataPreservation.test.ts',
  'eventRangeBackfill.test.ts',
].map((name) => path.posix.join(RLS_DIR, name));

function isRlsTestFile(name) {
  return name.endsWith('.test.ts') || name.endsWith('.test.mjs');
}

const allFiles = readdirSync(RLS_DIR)
  .filter(isRlsTestFile)
  .map((name) => path.posix.join(RLS_DIR, name));

for (const file of MIGRATION_REPLAY_FILES) {
  if (!allFiles.includes(file)) {
    console.error(`scripts/run-rls-suite.mjs: expected migration-replay file missing: ${file}`);
    process.exitCode = 1;
    process.exit();
  }
}

const migrationReplaySet = new Set(MIGRATION_REPLAY_FILES);
const parallelFiles = allFiles.filter((file) => !migrationReplaySet.has(file));

function runNodeTest(files, extraArgs) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--test', ...extraArgs, ...files],
    { stdio: 'inherit' },
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

const parallelStatus = runNodeTest(parallelFiles, []);
if (parallelStatus !== 0) {
  process.exitCode = parallelStatus;
  process.exit();
}

const migrationStatus = runNodeTest(MIGRATION_REPLAY_FILES, ['--test-concurrency=1']);
process.exitCode = migrationStatus;
