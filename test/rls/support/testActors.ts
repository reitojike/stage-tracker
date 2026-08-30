import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
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

/**
 * service_role client. Setup/teardown and inspection only - see this
 * module's header for why no assertion goes through it. Fixtures that need
 * to look at a row the acting user is (correctly) not allowed to read use
 * this rather than relaxing the policy under test; the assertion itself
 * still runs on the user's own client.
 */
export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface TestActor {
  user: User;
  client: SupabaseClient<Database>;
}

export interface TestActorOptions {
  /**
   * Grants designated catalog creator membership (Issue #29) right after
   * the user is created. Event creation is restricted to that membership,
   * so any actor a test uses to produce fixture events needs it; actors
   * used only to prove denial deliberately do not.
   */
  designatedCatalogCreator?: boolean;
}

/**
 * Grants designated catalog creator membership through the service_role
 * admin path. `authenticated` has no write privilege on catalog_creators
 * at all, which is the point - this is setup, and mirrors the operational
 * grant script (scripts/grant-catalog-creator.mjs), not something a test's
 * own client could do to itself.
 */
export async function grantCatalogCreator(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('catalog_creators')
    .upsert({ user_id: userId }, { onConflict: 'user_id' });
  if (error) {
    throw new Error(`failed to grant catalog creator to ${userId}: ${error.message}`);
  }
}

export async function revokeCatalogCreator(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('catalog_creators').delete().eq('user_id', userId);
  if (error) {
    throw new Error(`failed to revoke catalog creator from ${userId}: ${error.message}`);
  }
}

/**
 * Creates a confirmed auth user (admin/setup path) and signs in as that user
 * through the anon-key client (the same path a real client uses), returning
 * only the signed-in client for use in assertions.
 */
export async function createTestActor(
  emailPrefix: string,
  password: string,
  options: TestActorOptions = {},
): Promise<TestActor> {
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

  if (options.designatedCatalogCreator === true) {
    await grantCatalogCreator(created.user.id);
  }

  const client = createAnonymousClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    // Don't leave a bare, unusable user behind just because sign-in failed
    // after creation succeeded. Report a cleanup failure here too, rather
    // than discarding it, so it doesn't go unnoticed.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
    const cleanupSuffix = cleanupError
      ? ` (cleanup of the orphaned user also failed: ${cleanupError.message})`
      : '';
    throw new Error(
      `failed to sign in as test user ${email}: ${signInError.message}${cleanupSuffix}`,
    );
  }

  return { user: created.user, client };
}

// Chunked rather than one `.in()` call: the id list is embedded directly in
// the request URL, and a fixture actor that owns hundreds of events (e.g.
// pagination tests) can otherwise produce a "URI too long" error that has
// nothing to do with the RLS behavior under test.
const ID_BATCH_SIZE = 100;

// See the retry loop at the end of deleteTestActor for why user deletion,
// and only user deletion, is retried.
const DELETE_USER_ATTEMPTS = 3;
const DELETE_USER_RETRY_BASE_MS = 200;

function idBatches(ids: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += ID_BATCH_SIZE) {
    batches.push(ids.slice(start, start + ID_BATCH_SIZE));
  }
  return batches;
}

export async function deleteTestActor(actor: TestActor): Promise<void> {
  const admin = createAdminClient();

  // personal_schedule_entries.owner_id and personal_schedule_shares.
  // shared_with_user_id both reference auth.users(id) with no ON DELETE
  // action (Issue #31), and personal_schedule_shares.schedule_entry_id
  // references personal_schedule_entries(id), also with no ON DELETE
  // action. A test actor can appear as either an entry owner or a share
  // recipient (or both), so clean up every angle before the events/
  // occurrences cleanup below and before deleting the user itself.
  const { error: deleteSharesAsRecipientError } = await admin
    .from('personal_schedule_shares')
    .delete()
    .eq('shared_with_user_id', actor.user.id);
  if (deleteSharesAsRecipientError) {
    throw new Error(
      `failed to delete fixture schedule shares received by test user ${actor.user.id}: ${deleteSharesAsRecipientError.message}`,
    );
  }

  const { data: ownedScheduleEntries, error: selectScheduleEntriesError } = await admin
    .from('personal_schedule_entries')
    .select('id')
    .eq('owner_id', actor.user.id);
  if (selectScheduleEntriesError) {
    throw new Error(
      `failed to list fixture schedule entries for test user ${actor.user.id}: ${selectScheduleEntriesError.message}`,
    );
  }

  const ownedScheduleEntryIds = ownedScheduleEntries.map((entry) => entry.id);
  for (const batch of idBatches(ownedScheduleEntryIds)) {
    const { error: deleteSharesOnOwnedEntriesError } = await admin
      .from('personal_schedule_shares')
      .delete()
      .in('schedule_entry_id', batch);
    if (deleteSharesOnOwnedEntriesError) {
      throw new Error(
        `failed to delete fixture schedule shares on entries owned by test user ${actor.user.id}: ${deleteSharesOnOwnedEntriesError.message}`,
      );
    }
  }

  const { error: deleteScheduleEntriesError } = await admin
    .from('personal_schedule_entries')
    .delete()
    .eq('owner_id', actor.user.id);
  if (deleteScheduleEntriesError) {
    throw new Error(
      `failed to delete fixture schedule entries for test user ${actor.user.id}: ${deleteScheduleEntriesError.message}`,
    );
  }

  // Every FK reaching these tables is declared with no ON DELETE action, so
  // fixture teardown has to delete innermost-first or the FK check fails:
  //
  //   occurrence_invitations -> event_occurrences, auth.users
  //   occurrence_participations -> event_occurrences, auth.users
  //   event_occurrences -> events
  //   events -> auth.users
  //
  // catalog_creators (Issue #29) needs no equivalent step: its user_id FK is
  // ON DELETE CASCADE, so a granted actor’s membership row goes with the
  // user.
  //
  // Two directions matter for this actor. Rows this actor *created*
  // elsewhere (participations/invitations on someone else's occurrence) are
  // removed by user id; rows *other* actors created on this actor’s own
  // occurrences are removed by occurrence id, since those would otherwise
  // block deleting this actor’s occurrences. This is admin-path
  // setup/teardown, not an RLS assertion, and it does not decide product
  // deletion/cancellation semantics for any of these tables.
  const { data: ownedEvents, error: selectEventsError } = await admin
    .from('events')
    .select('id')
    .eq('owner_id', actor.user.id);
  if (selectEventsError) {
    throw new Error(
      `failed to list fixture events for test user ${actor.user.id}: ${selectEventsError.message}`,
    );
  }
  const ownedEventIds = ownedEvents.map((event) => event.id);

  const ownedOccurrenceIds: string[] = [];
  for (const batch of idBatches(ownedEventIds)) {
    const { data: occurrences, error: selectOccurrencesError } = await admin
      .from('event_occurrences')
      .select('id')
      .in('event_id', batch);
    if (selectOccurrencesError) {
      throw new Error(
        `failed to list fixture occurrences for test user ${actor.user.id}: ${selectOccurrencesError.message}`,
      );
    }
    ownedOccurrenceIds.push(...occurrences.map((occurrence) => occurrence.id));
  }

  const failIfError = (label: string, error: PostgrestError | null): void => {
    if (error) {
      throw new Error(
        `failed to delete fixture ${label} for test user ${actor.user.id}: ${error.message}`,
      );
    }
  };

  failIfError(
    'invitations sent',
    (await admin.from('occurrence_invitations').delete().eq('inviter_id', actor.user.id)).error,
  );
  failIfError(
    'invitations received',
    (await admin.from('occurrence_invitations').delete().eq('invitee_id', actor.user.id)).error,
  );
  failIfError(
    'participations',
    (await admin.from('occurrence_participations').delete().eq('user_id', actor.user.id)).error,
  );

  for (const batch of idBatches(ownedOccurrenceIds)) {
    failIfError(
      'invitations on owned occurrences',
      (await admin.from('occurrence_invitations').delete().in('occurrence_id', batch)).error,
    );
    failIfError(
      'participations on owned occurrences',
      (await admin.from('occurrence_participations').delete().in('occurrence_id', batch)).error,
    );
  }

  for (const batch of idBatches(ownedEventIds)) {
    failIfError(
      'occurrences',
      (await admin.from('event_occurrences').delete().in('event_id', batch)).error,
    );
  }

  failIfError('events', (await admin.from('events').delete().eq('owner_id', actor.user.id)).error);

  // Deleting the user itself is retried, unlike every step above. Auth user
  // deletion is a multi-table write inside the auth schema (identities,
  // sessions, refresh tokens), and `node --test` runs every DB/RLS test file
  // as its own process, so the whole suite creates and deletes users against
  // one local stack at once. That has been observed to surface as GoTrue's
  // generic "Database error deleting user" in one file's teardown while the
  // same suite passes on the next run.
  //
  // Retrying is safe precisely because it cannot hide a real problem: a row
  // this teardown genuinely failed to clean up still references
  // auth.users(id) on every attempt, so a deterministic FK failure still
  // fails. Every attempt's message is reported, not just the last one -
  // otherwise a real leftover-row error on the first attempt could be
  // replaced by a transient one from the last, which is exactly the
  // misdiagnosis this retry is supposed to avoid causing.
  const attemptErrors: string[] = [];
  for (let attempt = 0; attempt < DELETE_USER_ATTEMPTS; attempt += 1) {
    const { error } = await admin.auth.admin.deleteUser(actor.user.id);
    if (!error) {
      return;
    }
    attemptErrors.push(`attempt ${String(attempt + 1)}: ${error.message}`);

    // No sleep after the final attempt - it would only delay the throw.
    if (attempt < DELETE_USER_ATTEMPTS - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, DELETE_USER_RETRY_BASE_MS * (attempt + 1)),
      );
    }
  }

  throw new Error(
    `failed to delete test user ${actor.user.id} after ${String(DELETE_USER_ATTEMPTS)} attempts: ${attemptErrors.join('; ')}`,
  );
}

/** Tears actors down one at a time so one actor cannot delete a shared parent
 * while another actor is still deleting its child fixtures. */
export async function deleteTestActorsSequentially(actors: TestActor[]): Promise<void> {
  const messages: string[] = [];
  for (const actor of actors) {
    try {
      await deleteTestActor(actor);
    } catch (error) {
      messages.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (messages.length > 0) {
    throw new Error(`test actor cleanup failed:\n${messages.join('\n')}`);
  }
}
