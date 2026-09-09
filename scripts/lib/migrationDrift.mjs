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

  // fail closed —— **drift の判定より前に行う。**
  //
  // pending でも remote-only でもない entry は 'synced' の positive evidence
  // にならない。
  //
  //   { local: 'A', remote: 'B' }   version 不一致
  //   {}                            どちらも空
  //
  // さらに、**pending と同時に存在する場合も判断材料にできない**。
  // 'drift' として返すと呼び出し側は pendingLocal だけを見て
  // 「あとは pending を適用すれば揃う」と読むが、repository と Production の
  // 対応が確認できていない。この module の header が宣言する
  // 「positive evidence 無しに synced を返さない」を、drift 側にも適用する。
  //
  // pendingLocal / remoteOnly は operator が状況を読めるよう payload に残す。
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
