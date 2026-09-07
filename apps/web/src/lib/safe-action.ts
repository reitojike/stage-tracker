import { createSafeActionClient } from "next-safe-action";
import { ActionError, type ActionErrorShape } from "@/lib/action-error";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function toActionErrorShape(error: Error): ActionErrorShape {
  if (error instanceof ActionError) {
    return { kind: error.kind, message: error.message };
  }

  // 分類されていない例外の詳細（DB/RLS の生メッセージ、スタック等）を
  // client へ渡さない。原因は server 側のログから追う。
  console.error(error);
  return { kind: "failure", message: "予期しないエラーが発生しました。" };
}

/**
 * 全 Server Action の base client。
 *
 * validation adapter には Zod をそのまま使う。`next-safe-action` v8 は
 * Standard Schema（zod v3.24+/v4 が実装するインターフェース）を
 * `inputSchema()` が直接受け取るため、v7 系にあった専用の zod adapter
 * パッケージは不要。
 */
export const actionClient = createSafeActionClient({
  handleServerError: toActionErrorShape,
});

/**
 * 認証済みユーザーを要求する Server Action 用 client。
 *
 * Supabase server client で `auth.getUser()` を呼び、セッションが無ければ
 * `unauthenticated` kind の `ActionError` を投げる。取得できた Supabase
 * client と userId は `ctx` 経由で action 本体へ渡し、action 内で
 * client を作り直さなくてよいようにする。
 *
 * `docs/v2/oracle-domain.md` §3 の「各 action は権限判定を一切行わない。
 * 権限は常に DB（RLS/RPC 内の membership check）が enforce する」という
 * 設計は維持する。ここでの認証チェックは「DB まで到達してから権限エラーを
 * 受け取るのではなく、先回りにセッション切れを検出する」ための分類であり、
 * RLS の代替ではない（同 §4.2 の `requireAuthenticatedUserId` と同じ
 * 位置づけ）。
 */
export const authActionClient = actionClient.use(async ({ next }) => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ActionError("unauthenticated", "サインインが必要です。");
  }

  return next({ ctx: { supabase, userId: user.id } });
});
