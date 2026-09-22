import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "@/lib/data/database.types";

export function createPrivilegedIngestionClient(): SupabaseClient<Database> {
  const secretKey = env.STAGE_TRACKER_INGESTION_SUPABASE_SECRET_KEY;
  if (secretKey === undefined) {
    throw new Error("Official ingestion credential is not configured");
  }
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
