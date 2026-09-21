"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * サインアウトの Server Action（`specs/009-authentication-account-access/spec.md`
 * `/sign-out`）。専用ページは持たず、実装済みの `/mypage` の
 * `AccountSection` フォームから呼ばれる。
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
