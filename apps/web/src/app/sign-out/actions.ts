"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sign-out account lifecycle is covered by Spec 009. This Server Action and
 * its `/mypage` form wiring are exact runtime mechanics; there is no separate
 * sign-out page.
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
