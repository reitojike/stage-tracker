// Pure logic for the pre-merge migration ordering fence (Issue #131, revised
// by #393). Kept separate from scripts/check-migration-ordering-fence.mjs's
// git/env I/O so the classification rules are unit-testable without a real
// PR or git repo.
//
// ## Two different dependency directions, and why this fence now asks the
// ## second one
//
// #121/#124/#125 were the first direction: **code → schema**. The merged
// frontend code referenced a column/RPC immediately, but Production
// Supabase migration apply lagged the Vercel auto-deploy, so the new code
// ran against a schema that didn't have it yet. The Artifact Sequencing
// Fence (scripts/lib/artifactSequencingFence.mjs, Issue #387 PO 判断
// D1 = D) rejects any *single* PR that puts a migration and deployable app
// code together, but it does **not** guarantee merge order *across* two
// separate PRs (docs/v2/decisions.md "D が保証しないこと（残存リスク）") -
// an app-code-only PR can still be merged before the migration PR it
// depends on, reproducing the same failure. That residual risk is still a
// reviewer-discipline concern for the *migration* PR's reviewer (confirm
// the dependent code PR, if any, lands after this migration is merged and
// applied); this fence does not attempt to gate it mechanically (Issue #393
// Out of Scope: no cross-PR merge-order gate, per PR #388's 4-round
// failure).
//
// PR #389 (docs/v2/decisions.md "A8 追補") showed the second, opposite
// direction: **schema → code**. The migration itself changed a value that
// *already-deployed* code reads (an `error.code` emitted by a RPC), and the
// already-deployed reader (`apps/web`'s `classifyRpcError`) gated on the old
// value before looking at anything else - so the new value silently fell
// through to a generic path. This fence's marker vocabulary targets this
// direction: it asks whether *this* migration is safe regardless of when a
// dependent runtime change ships (`additive`), or requires that dependent
// runtime change to already be live in Production first
// (`runtime-first-required`). "Live in Production" means the Vercel
// deployment has *completed*, not merely that the runtime PR was merged -
// Vercel's build/deploy is asynchronous, so a PR can be merged while the
// old code is still serving traffic (Codex review, PR #398).
//
// As before, this fence cannot verify that the declared runtime dependency
// was actually deployed (CI has no Production credentials for this job by
// design; see docs/architecture/runtime-stack.md "Environment Variables の
// 所有境界"), only that the judgment and its evidence were recorded.
// Judgment *correctness* is the reviewer's job (docs/v2/decisions.md "fence
// が判定すること / しないこと"); this fence only prevents the judgment from
// being silently skipped.

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
//
// "additive": no already-deployed reader's observed behavior changes for
//   any value it could previously produce/observe. Safe regardless of
//   whether this migration is applied before or after any given deploy.
// "runtime-first-required": this migration changes a value or shape that
//   an already-deployed reader consults (an emitted error code, an enum's
//   semantics, a constraint an existing writer could violate, a column a
//   deployed reader still reads, ...). The runtime change that already
//   tolerates/produces the new value must already be **deployed** to
//   Production - not merely merged - before this migration merges (a
//   merged PR's Vercel deployment can still be building, queued, or
//   failed).
const ORDERING_PATTERN = /migration ordering:[\s*_`]*(additive|runtime-first-required)[\s*_`]*/gi;
const RUNTIME_DEPENDENCY_PATTERN = /runtime dependency deployed:\s*(.+)/i;
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
  // PR) contains example "Migration ordering:" / "Runtime dependency
  // deployed:" text that must never be mistaken for an author's real marker.
  const body = (typeof prBody === 'string' ? prBody : '').replace(HTML_COMMENT_PATTERN, '');

  const orderingMatches = [...body.matchAll(ORDERING_PATTERN)];
  // More than one marker means either the template's two scaffold lines
  // were never edited down to one, or the author left conflicting markers -
  // either way, no single unambiguous judgment was recorded.
  const classification = orderingMatches.length === 1 ? orderingMatches[0][1].toLowerCase() : null;

  const runtimeDependencyMatch = RUNTIME_DEPENDENCY_PATTERN.exec(body);
  const runtimeDependencyEvidence = runtimeDependencyMatch
    ? runtimeDependencyMatch[1].trim()
    : null;

  return {
    classification,
    ambiguous: orderingMatches.length > 1,
    runtimeDependencyEvidence:
      runtimeDependencyEvidence && runtimeDependencyEvidence.length > 0
        ? runtimeDependencyEvidence
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

  const { classification, ambiguous, runtimeDependencyEvidence } = extractMigrationOrdering(prBody);

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
        'the required "Migration ordering: additive" or "Migration ordering: ' +
        'runtime-first-required" line. See docs/architecture/runtime-stack.md "デプロイ・実行経路" ' +
        'for the criteria, and .github/pull_request_template.md for the exact format.',
    };
  }

  if (classification === 'runtime-first-required' && runtimeDependencyEvidence === null) {
    return {
      ok: false,
      reason:
        'This PR is marked "Migration ordering: runtime-first-required" but is missing a ' +
        '"Runtime dependency deployed: <evidence>" line in the PR body. Merging the runtime PR is ' +
        "not enough - Vercel's deploy is asynchronous, so confirm its Production deployment has " +
        'actually completed (e.g. the Vercel deployment URL/timestamp) before merging this ' +
        'migration, then record that evidence.',
    };
  }

  return {
    ok: true,
    reason: `Migration ordering recorded as "${classification}"${
      runtimeDependencyEvidence
        ? ` with runtime dependency evidence: ${runtimeDependencyEvidence}`
        : ''
    }.`,
  };
}
