import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * designated catalog creator membership（`public.catalog_creators`）の
 * fail-closed 判定。`AGENTS.md`「MVP Event catalog write boundary」の
 * とおり、真の権限境界は `create_event` RPC 側の membership check
 * （`supabase/migrations/20260822000300_restrict_event_create_to_catalog_creators.sql`）
 * にあり、ここでの判定は「フォームを描画するかどうか」のレンダー制御に
 * 過ぎない。読み取り失敗は `false`（fail-closed）。
 *
 * `apps/web/src/lib/data/` は変更禁止のため、この画面固有の read は
 * route-local に置く（`apps/web/src/app/mypage/_data/identity.ts` の
 * `resolveCanCreateEvent` と同じ判断を、別 route から重複して持つ —
 * 既存の `_lib/today.ts` 的な per-route 重複方針を踏襲する）。
 */
export async function isDesignatedCatalogCreator(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
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
