"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * サインアウトの Server Action（`docs/v2/oracle-routes-ui.md` §1
 * `/sign-out`）。専用ページは持たず、認証済み画面（例: `/mypage`）の
 * フォームから呼ばれる想定。`/mypage` 自体は本 Task の scope 外のため
 * 未実装 —— この action はまだどの画面からも呼ばれていない。
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
