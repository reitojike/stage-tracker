// Pure classification logic for the Production migration drift check
// (Issue #131). Separated from scripts/check-migration-drift.mjs's CLI/
// spawnSync I/O so the "never report synced without positive evidence"
// semantics are unit-testable without a real linked Supabase project.
//
// `supabase migration list --linked --output-format json` returns
// { migrations: [{ local, remote, time }, ...] }. A migration missing
// `remote` is applied locally/in the repo but not yet pushed to Production
// (pending). A migration missing `local` is applied to Production but has
// no matching repository migration file (unexpected drift - e.g. a
// Dashboard hand-edit or a removed/renamed local file). Either case must
// surface as actionable, never as silently synced.

export function classifyMigrationDrift(parsed) {
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.migrations)) {
    return {
      status: 'unknown',
      pendingLocal: [],
      remoteOnly: [],
      reason: 'Response did not contain a migrations array; cannot confirm sync state.',
    };
  }

  const pendingLocal = parsed.migrations
    .filter((entry) => isNonEmpty(entry?.local) && !isNonEmpty(entry?.remote))
    .map((entry) => entry.local);
  const remoteOnly = parsed.migrations
    .filter((entry) => isNonEmpty(entry?.remote) && !isNonEmpty(entry?.local))
    .map((entry) => entry.remote);

  if (pendingLocal.length > 0 || remoteOnly.length > 0) {
    return { status: 'drift', pendingLocal, remoteOnly, reason: null };
  }

  return {
    status: 'synced',
    pendingLocal: [],
    remoteOnly: [],
    reason: `${parsed.migrations.length} migration(s) match between repository and Production.`,
  };
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.length > 0;
}
