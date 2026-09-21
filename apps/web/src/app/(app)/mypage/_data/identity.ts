import type { SupabaseClient } from "@supabase/supabase-js";
import { userIdSchema, type UserId } from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/mypage` が必要とする identity/権限 read（`specs/009-authentication-account-access/spec.md`
 * `/mypage`: `getAuthenticatedUser`）。Auth API orchestration remains
 * route-local; reusable table reads are kept in `lib/data`.
 */

export interface MyPageAccount {
  readonly userId: UserId;
  readonly email: string | null;
}

/** 認証済みでなければ `null`。email 取得失敗は「識別情報行を出さない」
 * という product rule（specs/009-authentication-account-access/spec.md「マイページ」節）に従い `email: null`
 * として扱う（呼び出し元は行自体を非表示にする）。 */
export async function getMyPageAccount(): Promise<MyPageAccount | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || user === null) {
    return null;
  }
  const parsedUserId = userIdSchema.safeParse(user.id);
  if (!parsedUserId.success) {
    return null;
  }
  return { userId: parsedUserId.data, email: user.email ?? null };
}

/**
 * pending invitation バッジ用の件数のみの read。件数表示は低優先度の
 * badge であり、このページの主要データ surface ではないため、読込失敗は
 * 0 件へ degrade する（M8 の既存方針を踏襲。
 * `/catalog/invitations` 本体は別途 unavailable/error を
 * 正しく区別する - `@/lib/data/reads/invitations.ts`
 * 参照）。
 */
export async function countMyPendingInvitations(
  supabase: SupabaseClient<Database>,
  userId: UserId,
): Promise<number> {
  const { count, error } = await supabase
    .from("occurrence_invitations")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", userId);
  if (error || count === null) {
    return 0;
  }
  return count;
}
