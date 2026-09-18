import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserId } from "@stage-tracker/domain";
import type { Database } from "./database.types";

/**
 * UI capability check for catalog event creation. The database/RPC membership
 * check remains the authorization boundary; this read only controls whether
 * the create surface is rendered. Any read failure is deliberately false.
 */
export async function isDesignatedCatalogCreator(
  client: SupabaseClient<Database>,
  userId: UserId,
): Promise<boolean> {
  const { data, error } = await client
    .from("catalog_creators")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  return error === null && data !== null;
}
