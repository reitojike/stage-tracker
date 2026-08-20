import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Database } from '../../../src/infrastructure/supabase/database.types.ts';
import { readLocalSupabaseStatus } from '../../rls/support/localSupabase.ts';

const status = readLocalSupabaseStatus();

export function createAnonymousClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.anonKey);
}

function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Admin-provisions an account with no password (public signup is disabled
 * and this product is magic-link-only - see supabase/config.toml and
 * scripts/provision-user.mjs). Signing in as this user always goes
 * through the real signInWithOtp -> verifyOtp path, never a shortcut.
 */
export async function provisionUser(emailPrefix: string): Promise<{ user: User; email: string }> {
  const admin = createAdminClient();
  const email = `${emailPrefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;

  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error) {
    throw new Error(`failed to provision test user ${email}: ${error.message}`);
  }

  return { user: data.user, email };
}

export async function deleteUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error(`failed to delete test user ${userId}: ${error.message}`);
  }
}
