import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Database } from '../../../src/infrastructure/supabase/database.types.ts';
import { readLocalSupabaseStatus } from './localSupabase.ts';

// This module is the fixture/setup boundary for DB/RLS tests: it creates
// and tears down test users using the service_role admin path. Nothing here
// is used to perform or assert the RLS-governed operations under test -
// those always go through the anon-key clients returned by
// createAnonymousClient / signInAsUser below, which carry only the
// permissions a real end user would have.

const status = readLocalSupabaseStatus();

export function createAnonymousClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.anonKey);
}

function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestActor {
  user: User;
  client: SupabaseClient<Database>;
}

/**
 * Creates a confirmed auth user (admin/setup path) and signs in as that user
 * through the anon-key client (the same path a real client uses), returning
 * only the signed-in client for use in assertions.
 */
export async function createTestActor(emailPrefix: string, password: string): Promise<TestActor> {
  const admin = createAdminClient();
  const email = `${emailPrefix}-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`failed to create test user ${email}: ${createError.message}`);
  }

  const client = createAnonymousClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`failed to sign in as test user ${email}: ${signInError.message}`);
  }

  return { user: created.user, client };
}

export async function deleteTestActor(actor: TestActor): Promise<void> {
  const admin = createAdminClient();

  // events.owner_id references auth.users(id) with no ON DELETE action, so
  // deleting a user who still owns fixture events would fail the FK check.
  // Clean those up first via the admin path (setup/teardown, not an RLS
  // assertion) so teardown actually removes what each test created.
  const { error: deleteEventsError } = await admin
    .from('events')
    .delete()
    .eq('owner_id', actor.user.id);
  if (deleteEventsError) {
    throw new Error(
      `failed to delete fixture events for test user ${actor.user.id}: ${deleteEventsError.message}`,
    );
  }

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(actor.user.id);
  if (deleteUserError) {
    throw new Error(`failed to delete test user ${actor.user.id}: ${deleteUserError.message}`);
  }
}
