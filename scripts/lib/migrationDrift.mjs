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

  // fail closed —— **drift の判定より先に行う。**
  //
  // pending / remote-only のどちらでもない entry は、'synced' の positive
  // evidence にならないだけでなく、**pending と同時に存在する場合も
  // 判断材料にできない**。
  //
  //   { local: 'A', remote: null }            <- pending
  //   { local: 'B', remote: 'C' }             <- 対応不明
  //
  // これを 'drift' として返すと、`planMigrationApply` は status が
  // 'unknown' でなく remoteOnly が空で pendingLocal が非空なのを見て
  // **'apply' を返し、Production に対して `supabase db push` が走る**。
  // repository と Production の対応が確認できていないまま。
  //
  // 前 revision はこの検査を drift の後ろに置き、その挙動をテストで
  // 固定してしまっていた（PR #390 codex finding）。Production への
  // write path では、確証の無い状態を actionable 扱いしない。
  //
  // pendingLocal / remoteOnly は operator が状況を読めるよう payload に
  // 残す。`planMigrationApply` は 'unknown' を先に見て stop するので、
  // この値が apply の根拠になることはない。
  const unverifiable = parsed.migrations.filter((entry) => {
    const hasLocal = isNonEmpty(entry?.local);
    const hasRemote = isNonEmpty(entry?.remote);
    if (hasLocal && !hasRemote) return false; // pending（上で拾っている）
    if (hasRemote && !hasLocal) return false; // remote-only（上で拾っている）
    if (hasLocal && hasRemote) return entry.local !== entry.remote; // version 不一致
    return true; // どちらも空
  });
  if (unverifiable.length > 0) {
    return {
      status: 'unknown',
      pendingLocal,
      remoteOnly,
      reason:
        `${String(unverifiable.length)} migration entr(y/ies) were neither pending nor ` +
        'remote-only and did not pair a matching local/remote version; cannot confirm the ' +
        'repository/Production correspondence.',
    };
  }

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
