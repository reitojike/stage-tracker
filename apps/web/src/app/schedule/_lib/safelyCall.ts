import { ActionError } from "@/lib/action-error";

export type SafeCallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

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
 */
export async function safelyCall<T>(
  fn: () => Promise<T>,
): Promise<SafeCallResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (thrown) {
    if (thrown instanceof ActionError) {
      return { ok: false, message: thrown.message };
    }
    console.error(thrown);
    return { ok: false, message: "予期しないエラーが発生しました。" };
  }
}
