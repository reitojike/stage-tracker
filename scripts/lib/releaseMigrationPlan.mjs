// Release workflow が「migration を適用するか」を決める純関数
// （Issue #387、PO 判断 D1 = C）。
//
// `classifyMigrationDrift` は「同期しているか」だけを答え、pending も
// remote-only もまとめて drift とする。release ではこの 2 つを区別しな
// ければならない。
//
//   pendingLocal のみ -> apply（通常の schema 変更）
//   remoteOnly あり   -> stop。repository に対応するファイルが無い
//                        migration が Production に適用されている状態で、
//                        Dashboard の手編集やファイル削除/改名が疑われる。
//                        **その上に local を重ねてはいけない**
//   unknown           -> stop。「何も無い」という証拠ではない
//
// CLI/spawnSync の I/O から切り離してあるのは、この分岐をテストで固定
// するため（`check-migration-drift.mjs` が classifyMigrationDrift を
// 切り出しているのと同じ理由）。

/**
 * @param {{status: string, pendingLocal: string[], remoteOnly: string[], reason: string | null}} classification
 * @returns {{action: "apply" | "skip" | "stop", cause: "remote-only" | "unknown" | null, pending: string[], reason: string}}
 */
export function planReleaseMigrations(classification) {
  if (classification.status === 'unknown') {
    return {
      action: 'stop',
      // 呼び出し側が exit code を分けるための discriminant。message の
      // 文字列一致で判断しない（PR #388 review）。
      cause: 'unknown',
      pending: [],
      reason: classification.reason ?? 'Could not determine Production migration state.',
    };
  }

  if (classification.remoteOnly.length > 0) {
    return {
      action: 'stop',
      cause: 'remote-only',
      pending: [],
      reason:
        'Production has migration(s) with no matching file in this repository: ' +
        `${classification.remoteOnly.join(', ')}. Applying local migrations on top of an ` +
        'unexplained Production state is not safe.',
    };
  }

  if (classification.pendingLocal.length > 0) {
    return {
      action: 'apply',
      cause: null,
      pending: classification.pendingLocal,
      reason: `${String(classification.pendingLocal.length)} pending migration(s) to apply.`,
    };
  }

  return {
    action: 'skip',
    cause: null,
    pending: [],
    reason: classification.reason ?? 'No pending migrations.',
  };
}
