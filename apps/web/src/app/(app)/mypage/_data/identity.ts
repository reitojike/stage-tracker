import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * `/mypage` が必要とする identity/権限 read（`docs/v2/oracle-routes-ui.md`
 * §1 `/mypage`: `getAuthenticatedUser`、`resolveCanCreateEvent`）。
 * `apps/web/src/lib/data/` は完成済みの read boundary で変更禁止のため、
 * この画面固有の read はここへ route-local に置く（`_lib/today.ts` 等、
 * 機能ごとに個別に持つ既存の設計方針を踏襲する）。
 */

export interface MyPageAccount {
  readonly userId: string;
  readonly email: string | null;
}

/** 認証済みでなければ `null`。email 取得失敗は「識別情報行を出さない」
 * という product rule（AGENTS.md「マイページ」節）に従い `email: null`
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
  return { userId: user.id, email: user.email ?? null };
}

/**
 * designated catalog creator membership（`public.catalog_creators`）の
 * fail-closed 判定。`AGENTS.md`「MVP Event catalog write boundary」:
 * 真の権限境界は `create_event` RPC の membership check であり、ここでの
 * 判定は「イベントを追加」行を表示するかどうかのレンダー制御に過ぎない。
 * 読み取り失敗・未認証はすべて `false`（fail-closed - 「membership/read
 * failure を fail-open しない」）。
 */
export async function resolveCanCreateEvent(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<boolean> {
  if (userId === null) {
    return false;
  }
  const { data, error } = await supabase
    .from("catalog_creators")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return false;
  }
  return data !== null;
}

/**
 * pending invitation バッジ用の件数のみの read。件数表示は低優先度の
 * badge であり、このページの主要データ surface ではないため、読込失敗は
 * 0 件へ degrade する（`apps/legacy-web/src/app/mypage/page.tsx` の
 * 既存方針を踏襲。`/catalog/invitations` 本体は別途 unavailable/error を
 * 正しく区別する - `../../catalog/invitations/_data/listMyReceivedInvitations.ts`
 * 参照）。
 */
export async function countMyPendingInvitations(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<number> {
  if (userId === null) {
    return 0;
  }
  const { count, error } = await supabase
    .from("occurrence_invitations")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", userId);
  if (error || count === null) {
    return 0;
  }
  return count;
}
