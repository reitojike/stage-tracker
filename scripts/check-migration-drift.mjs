import { spawnSync } from 'node:child_process';
import { classifyMigrationDrift } from './lib/migrationDrift.mjs';

// Operator-only, read-only drift check against the linked Production
// Supabase project (Issue #131). This script itself is not wired into CI:
// it is always an explicit, session-local operator action
// (scripts/lib/adminTarget.mjs, docs/runbooks/gate-a-remote-environment.md),
// authenticated via the Supabase CLI's own linked-project auth
// (`supabase login` + `supabase link --project-ref <ref>`, per
// docs/runbooks/catalog-import.md "3a"). It performs no writes and no
// service-role key is required or used here.
//
// Separately, `.github/workflows/apply-migrations.yml` (Issue #387, PO 判断
// D1 = D) does hold a scoped, write-capable `SUPABASE_DB_URL` connection
// string as a GitHub Environment secret to auto-apply merged migrations.
// That workflow uses its own classify/plan path
// (scripts/apply-pending-migrations.mjs) and does not call this script; see
// docs/architecture/runtime-stack.md "Environment Variables の所有境界" for
// the current CI credential boundary.
//
// Usage (after `supabase link --project-ref <ref>` in this shell session):
//   node scripts/check-migration-drift.mjs --linked
//
// --linked must be passed explicitly - mirroring the --remote opt-in on
// scripts/provision-user.mjs and scripts/grant-catalog-creator.mjs, remote
// is never the default for a bare invocation.
//
// Exit codes:
//   0 - confirmed synced (positive evidence: a well-formed migrations list
//       came back and every entry's local/remote versions match)
//   1 - drift found (pending local-only or unexpected remote-only
//       migrations) - actionable, never collapsed into "green"
//   2 - unknown/failure (CLI not linked, auth failure, network failure,
//       malformed output) - never reported as synced

const args = process.argv.slice(2);
if (!args.includes('--linked')) {
  console.error('Usage: node scripts/check-migration-drift.mjs --linked');
  console.error(
    'Requires an already-linked Supabase CLI session (supabase login; supabase link ' +
      '--project-ref <ref>) - see docs/runbooks/catalog-import.md "3a".',
  );
  process.exitCode = 2;
  process.exit();
}

// Windows can only launch node_modules/.bin's supabase.cmd shim through a
// shell (Node throws EINVAL otherwise); the args below are static
// literals, not external input, so shell:true carries no injection risk
// here.
const result = spawnSync('supabase', ['migration', 'list', '--linked', '--output-format', 'json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (result.error || result.status !== 0) {
  console.error('UNKNOWN: failed to list migrations for the linked Production project.');
  if (result.error) console.error(result.error.message);
  if (result.stderr) console.error(result.stderr);
  console.error(
    'This is not evidence of sync - re-run after confirming `supabase link --project-ref <ref>` ' +
      'succeeded and the CLI session is authenticated (`supabase login`).',
  );
  process.exitCode = 2;
  process.exit();
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  console.error('UNKNOWN: could not parse `supabase migration list --linked` output as JSON.');
  console.error(error.message);
  process.exitCode = 2;
  process.exit();
}

const { status, pendingLocal, remoteOnly, reason } = classifyMigrationDrift(parsed);

if (status === 'unknown') {
  console.error(`UNKNOWN: ${reason}`);
  // 判定できなかった場合でも、読み取れた範囲は operator へ見せる。
  // これらは exit code の根拠ではなく、調査の手がかり。
  if (pendingLocal.length > 0) {
    console.error(`  Looked pending (not a sync claim): ${pendingLocal.join(', ')}`);
  }
  if (remoteOnly.length > 0) {
    console.error(`  Looked remote-only (not a sync claim): ${remoteOnly.join(', ')}`);
  }
  process.exitCode = 2;
  process.exit();
}

if (status === 'drift') {
  console.error('DRIFT: Production migration state does not match this repository.');
  if (pendingLocal.length > 0) {
    console.error(
      `  Pending (in repository, not yet applied to Production): ${pendingLocal.join(', ')}`,
    );
  }
  if (remoteOnly.length > 0) {
    console.error(
      `  Unexpected (applied to Production, no matching repository migration file): ${remoteOnly.join(', ')}`,
    );
  }
  console.error(
    'Pending migrations: apply with `supabase db push --linked` (operator action - see ' +
      'docs/runbooks/gate-a-remote-environment.md "Schema migration to the hosted project"). ' +
      'Unexpected remote-only entries need investigation before any further push.',
  );
  process.exitCode = 1;
  process.exit();
}

console.log(`SYNCED: ${reason}`);
