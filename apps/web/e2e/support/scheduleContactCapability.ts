import type { Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../../src/lib/data/database.types";
import { readLocalSupabaseStatus } from "./localSupabase";

/** Read with the actor's UI-issued session, never the fixture service role. */
export async function readScheduleContactCapability(
  page: Page,
  expectedUserId: string,
): Promise<boolean> {
  const status = readLocalSupabaseStatus();
  const client = createServerClient<Database>(status.apiUrl, status.anonKey, {
    cookies: { getAll: async () => page.context().cookies() },
  });
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError || identity.user?.id !== expectedUserId)
    throw new Error("capability caller does not match the signed-in actor");
  const { data, error } = await client.rpc(
    "schedule_contact_registration_enabled",
  );
  if (error || typeof data !== "boolean")
    throw new Error("schedule contact capability could not be read");
  return data;
}
