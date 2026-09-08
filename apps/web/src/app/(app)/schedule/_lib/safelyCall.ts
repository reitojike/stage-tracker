export type SafeCallResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

/**
 * `lib/actions/schedule/schedule-share-write.ts` の関数群は「例外で失敗を
 * 伝える」設計（`ActionError` を投げる - 通常は `next-safe-action` の
 * `.action()` 境界がこれを `ActionErrorShape` へ変換する前提、
 * `schedule-entry-write.ts` の doc comment参照）。
 *
 * しかし `/schedule/[entryId]` は owner 向けの recipient 一覧
 * （`listScheduleShareRecipientEmails`）と非owner向けの自分の share id
 * （`findOwnScheduleShareId`）を **Server Component の render 中**に
 * 直接呼ぶ - `next-safe-action` の境界を経由しない。Server Component が
 * 例外を投げっぱなしにすると最寄りの `error.tsx`（未実装）まで伝播し、
 * StatePanel の `unavailable`/`error` 区別を画面側で選べなくなる
 * （decisions.md「M6 が負う責任」）。このヘルパーはその場しのぎではなく、
 * 「例外で失敗を伝える write 層」と「`Result` で失敗を表現する画面表示」
 * という異なる2つの境界を、この呼び出し口だけで明示的に橋渡しする。
 *
 * `ok: false` は意図的に `message` を持たない（`@/lib/data/read-result.ts`
 * の `ReadState` が `unavailable`/`error` に `message` を持たせない設計 -
 * PR #381 review finding 2 - と同じ理由をこの feature-local な read-like
 * ヘルパーにも揃える）。呼び出し元の Server Component はこの `ok: false`
 * を受けて、`(app)/` 配下の read panel と同じ固定文言
 * （`@/app/_lib/read-state.ts` の `READ_FAILURE_RETRY_HINT_JA` 等）を表示
 * する - 投げられた `ActionError`/例外の `message`（`ActionError` 自身は
 * 安全な文言のみを持つ設計だが、それでも画面側の variant 駆動 copy を
 * 経由させ、`description={...message}` という形自体を作らない）は
 * `console.error` でサーバーログにのみ残す。
 */
export async function safelyCall<T>(
  fn: () => Promise<T>,
): Promise<SafeCallResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (thrown) {
    console.error("[schedule] safelyCall caught an exception", thrown);
    return { ok: false };
  }
}
