// Pure logic for the pre-merge migration ordering fence (Issue #131). Kept
// separate from scripts/check-migration-ordering-fence.mjs's git/env I/O so
// the classification rules are unit-testable without a real PR or git repo.
//
// Root cause this fence targets: #121/#124/#125 each shipped a migration
// that the merged frontend code referenced immediately, but Production
// Supabase migration apply lagged the Vercel auto-deploy, so the new code
// ran against a schema that didn't have the column/RPC yet
// (docs/architecture/runtime-stack.md "デプロイ・実行経路"). This fence
// forces the schema-first-required / post-deploy-safe judgment call to be
// made explicitly, in the PR body, before merge - it cannot verify that
// Production was actually migrated (CI has no Production credentials by
// design; see docs/architecture/runtime-stack.md "Environment Variables の
// 所有境界"), only that the judgment and its evidence were recorded.

const MIGRATION_PATH_PATTERN = /^supabase\/migrations\/.+\.sql$/;

// [\s*_`]* tolerates markdown emphasis/code-span punctuation (**bold**,
// `code`, _italic_) between the "ordering:" label and the value, so authors
// can format the marker line without breaking the match.
const ORDERING_PATTERN =
  /migration ordering:[\s*_`]*(schema-first-required|post-deploy-safe)[\s*_`]*/i;
const PRODUCTION_APPLY_PATTERN = /production migration applied:\s*(.+)/i;

export function parseAddedMigrationFiles(diffNameStatusOutput) {
  if (typeof diffNameStatusOutput !== 'string' || diffNameStatusOutput.length === 0) return [];
  return diffNameStatusOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => MIGRATION_PATH_PATTERN.test(line));
}

export function extractMigrationOrdering(prBody) {
  const body = typeof prBody === 'string' ? prBody : '';
  const orderingMatch = ORDERING_PATTERN.exec(body);
  const classification = orderingMatch ? orderingMatch[1].toLowerCase() : null;

  const productionApplyMatch = PRODUCTION_APPLY_PATTERN.exec(body);
  const productionApplyEvidence = productionApplyMatch ? productionApplyMatch[1].trim() : null;

  return {
    classification,
    productionApplyEvidence:
      productionApplyEvidence && productionApplyEvidence.length > 0
        ? productionApplyEvidence
        : null,
  };
}

export function evaluateMigrationOrderingFence({ addedMigrationFiles, prBody }) {
  if (!addedMigrationFiles || addedMigrationFiles.length === 0) {
    return {
      ok: true,
      reason: 'No new supabase/migrations/**.sql file in this PR; ordering fence not applicable.',
    };
  }

  const { classification, productionApplyEvidence } = extractMigrationOrdering(prBody);

  if (classification === null) {
    return {
      ok: false,
      reason:
        `This PR adds ${addedMigrationFiles.length} migration file(s) but the PR body is missing ` +
        'the required "Migration ordering: schema-first-required" or "Migration ordering: ' +
        'post-deploy-safe" line. See docs/architecture/runtime-stack.md "デプロイ・実行経路" for ' +
        'the criteria, and .github/pull_request_template.md for the exact format.',
    };
  }

  if (classification === 'schema-first-required' && productionApplyEvidence === null) {
    return {
      ok: false,
      reason:
        'This PR is marked "Migration ordering: schema-first-required" but is missing a ' +
        '"Production migration applied: <evidence>" line in the PR body. Apply the migration to ' +
        'Production (operator action; see docs/runbooks/gate-a-remote-environment.md "Schema ' +
        'migration to the hosted project") and record the evidence before merge.',
    };
  }

  return {
    ok: true,
    reason: `Migration ordering recorded as "${classification}"${
      productionApplyEvidence ? ` with Production apply evidence: ${productionApplyEvidence}` : ''
    }.`,
  };
}
