import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/data/database.types";
import { readLocalSupabaseStatus } from "./localSupabase";

/**
 * Service-role Supabase client for E2E test-data setup/teardown only - the
 * app under test never uses this key (`apps/web/src/env.ts` only accepts
 * the anon key). Every journey in this suite still authenticates and acts
 * through the real app UI; this client exists solely because public
 * signup is disabled (`supabase/config.toml` `enable_signup = false`), so
 * admin-provisioning is the only way to create an account for a journey to
 * sign in with. It also seeds shared-catalog rows (Event/
 * Occurrence) directly for journeys whose subject is *not* Event creation
 * itself (participation/invitation) so each journey stays self-contained
 * instead of depending on another journey's writes.
 */
export function createE2eAdminClient(): SupabaseClient<Database> {
  const status = readLocalSupabaseStatus();
  return createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface ProvisionedActor {
  readonly userId: string;
  readonly email: string;
}

/**
 * Admin-provisions an account with no password. Signing in as this actor
 * always goes through the real `/sign-in` -> Mailpit -> `/auth/confirm`
 * path (`e2e/support/signIn.ts`), never a Supabase SDK session shortcut.
 */
export async function provisionActor(
  admin: SupabaseClient<Database>,
  emailPrefix: string,
): Promise<ProvisionedActor> {
  const email = `${emailPrefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error || data.user === null) {
    throw new Error(
      `failed to provision e2e actor ${email}: ${error?.message ?? "unknown error"}`,
    );
  }
  return { userId: data.user.id, email };
}

/** Best-effort teardown - logs rather than throws so one leftover fixture
 * never masks the journey's own pass/fail result. */
export async function deleteActor(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(
      `[e2e cleanup] failed to delete actor ${userId}: ${error.message}`,
    );
  }
}

/**
 * Grants designated catalog creator membership (product-rules.md "MVP
 * Event catalog write boundary"): an upsert into
 * `public.catalog_creators`, never a hard-coded user id.
 */
export async function grantCatalogCreator(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { error } = await admin
    .from("catalog_creators")
    .upsert({ user_id: userId }, { onConflict: "user_id" });
  if (error) {
    throw new Error(
      `failed to grant catalog creator to ${userId}: ${error.message}`,
    );
  }
}
