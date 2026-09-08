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

const MIGRATION_DIR = 'supabase/migrations/';
const MIGRATION_SUFFIX = '.sql';

// **正規表現を使わない。** 末尾を固定する正規表現だと、git が許す
// **LF を含む filename** で `.` が LF を跨げず一致しない。その結果その file が
// migration として数えられず、fence が「migration の無い PR」として素通りする
// （fail open。PR #396 review finding）。
//
// 末尾アンカーが「最後の改行の直前」にも一致する挙動も含め、端点の解釈に
// 依存させない。
function isMigrationFile(file) {
  return (
    file.startsWith(MIGRATION_DIR) &&
    file.endsWith(MIGRATION_SUFFIX) &&
    file.length > MIGRATION_DIR.length + MIGRATION_SUFFIX.length
  );
}

// [\s*_`]* tolerates markdown emphasis/code-span punctuation (**bold**,
// `code`, _italic_) between the "ordering:" label and the value, so authors
// can format the marker line without breaking the match.
const ORDERING_PATTERN =
  /migration ordering:[\s*_`]*(schema-first-required|post-deploy-safe)[\s*_`]*/gi;
const PRODUCTION_APPLY_PATTERN = /production migration applied:\s*(.+)/i;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// NUL 区切り（`git diff -z`）と改行区切りの両方を受ける。呼び出し側が `-z` を
// 使うのは、既定の `core.quotepath=true` が非 ASCII を含む path を quote して
// 返し、migration と判定されなくなる（= その migration を
// 「追加されていない」とみなす fail open）を避けるため。
export function parseAddedMigrationFiles(diffNameStatusOutput) {
  if (typeof diffNameStatusOutput !== 'string' || diffNameStatusOutput.length === 0) return [];

  // NUL を含むなら `git diff -z` の出力。**NUL だけで区切り、trim しない。**
  // git は filename に LF を許すため、LF でも分割すると path が割れて
  // migration と判定されず、その migration を「追加されていない」
  // とみなす（fail open。PR #396 review finding）。
  const records = diffNameStatusOutput.includes('\0')
    ? diffNameStatusOutput.split('\0')
    : diffNameStatusOutput.split('\n').map((line) => line.trim());

  return records.filter((record) => record.length > 0).filter((record) => isMigrationFile(record));
}

export function extractMigrationOrdering(prBody) {
  // Strip HTML comments first: .github/pull_request_template.md's own
  // instructional text (inside an HTML comment, invisible in the rendered
  // PR) contains example "Migration ordering:" / "Production migration
  // applied:" text that must never be mistaken for an author's real marker.
  const body = (typeof prBody === 'string' ? prBody : '').replace(HTML_COMMENT_PATTERN, '');

  const orderingMatches = [...body.matchAll(ORDERING_PATTERN)];
  // More than one marker means either the template's two scaffold lines
  // were never edited down to one, or the author left conflicting markers -
  // either way, no single unambiguous judgment was recorded.
  const classification = orderingMatches.length === 1 ? orderingMatches[0][1].toLowerCase() : null;

  const productionApplyMatch = PRODUCTION_APPLY_PATTERN.exec(body);
  const productionApplyEvidence = productionApplyMatch ? productionApplyMatch[1].trim() : null;

  return {
    classification,
    ambiguous: orderingMatches.length > 1,
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

  const { classification, ambiguous, productionApplyEvidence } = extractMigrationOrdering(prBody);

  if (ambiguous) {
    return {
      ok: false,
      reason:
        `This PR adds ${addedMigrationFiles.length} migration file(s) but the PR body has more ` +
        'than one "Migration ordering: ..." marker line. Keep exactly one (delete the other, per ' +
        '.github/pull_request_template.md) so the ordering judgment is unambiguous.',
    };
  }

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
