import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapPersonalScheduleEntryRow,
  mapScheduleShareRecipientRow,
  mapScheduleShareRow,
  sortPersonalScheduleEntries,
  temporalToColumns,
  type PersonalScheduleEntry,
  type PersonalScheduleEntryInput,
  type ScheduleShare,
  type ScheduleShareRecipient,
} from '../../domain/personalSchedule.ts';
import {
  classifyPostgrestError,
  classifyRpcError,
  type PlanningResult,
  type RpcErrorRule,
} from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.personal_schedule_
// entries / public.personal_schedule_shares (Issue #33). RLS
// (personal_schedule_entries_select_owner_or_shared / _insert_own /
// _update_own, personal_schedule_shares_select_owner_or_recipient /
// _insert_owner / _delete_owner_or_self - see supabase/migrations/
// 20260822000000_create_personal_schedule.sql) is what actually enforces who
// may read/write what; this module performs no permission judgment of its
// own.

export type PersonalScheduleQueryClient = SupabaseClient<Database>;

const NOT_VISIBLE_FOR_WRITE = 'update-affected-no-rows';

/**
 * personal_schedule_entries' SELECT policy (owner-or-shared) is wider than
 * its UPDATE policy (owner-only): a shared recipient can see an entry they
 * cannot edit. A zero-rows update result is therefore classified
 * `permission-denied`, mirroring domain/eventCatalogWrite.ts's deniedUpdate
 * for events - the same "reads open wider than writes" shape.
 */
function deniedEntryUpdate(): PlanningResult<never> {
  return {
    ok: false,
    error: {
      kind: 'permission-denied',
      message:
        'personal schedule entry was not updated: the row is not visible to this caller for update',
      code: NOT_VISIBLE_FOR_WRITE,
    },
  };
}

/**
 * Every entry visible to the caller: their own, plus every entry explicitly
 * shared with them. A single read rather than "mine" and "shared with me"
 * as two calls, because RLS already merges both into the same visibility
 * set (personal_schedule_entries_select_owner_or_shared) - splitting it here
 * would just be re-deriving that union from two round trips instead of one.
 * Callers that need to label an entry "owner" vs. "shared" compare
 * `entry.ownerId` against their own id. Paginated via fetchAllRows so a
 * caller with more rows than PostgREST's api.max_rows never silently loses
 * the rest (see pagedFetch.ts).
 */
export async function listVisiblePersonalSchedule(
  client: PersonalScheduleQueryClient,
): Promise<PlanningResult<PersonalScheduleEntry[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('personal_schedule_entries')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return {
    ok: true,
    data: sortPersonalScheduleEntries(result.data.map(mapPersonalScheduleEntryRow)),
  };
}

/**
 * A single entry, if visible to the caller (their own, or shared with
 * them) - the same visibility set listVisiblePersonalSchedule reads, just
 * narrowed to one id for the schedule detail/edit UI journey (Issue #37)
 * instead of the whole list. A non-existent or not-visible id is `ok: true,
 * data: null` (RLS makes the two indistinguishable, matching
 * eventCatalogRead.ts's getEventWithOccurrences), not an error.
 */
export async function getVisiblePersonalScheduleEntry(
  client: PersonalScheduleQueryClient,
  entryId: string,
): Promise<PlanningResult<PersonalScheduleEntry | null>> {
  const { data, error } = await client
    .from('personal_schedule_entries')
    .select('*')
    .eq('id', entryId)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: data === null ? null : mapPersonalScheduleEntryRow(data) };
}

export async function createPersonalScheduleEntry(
  client: PersonalScheduleQueryClient,
  input: PersonalScheduleEntryInput,
): Promise<PlanningResult<PersonalScheduleEntry>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('personal_schedule_entries')
    .insert({
      owner_id: callerId.data,
      schedule_type: input.scheduleType,
      memo: input.memo,
      ...temporalToColumns(input.temporal),
    })
    .select()
    .single();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: mapPersonalScheduleEntryRow(data) };
}

/**
 * Updates an existing entry's fields. owner_id is deliberately not part of
 * the payload (it carries no UPDATE grant - see the migration), so
 * ownership stays non-transferable without this layer having to police it.
 *
 * Checks the caller's session first (requireAuthenticatedUserId), even
 * though this write needs no id from it, so an unauthenticated caller gets
 * `unauthenticated` here too - the same as createPersonalScheduleEntry -
 * rather than whatever a client with no session happens to get from RLS
 * (typically `permission-denied` from the withheld anon grant), which would
 * make otherwise-identical failures diverge only because one path is a
 * create and the other an update.
 */
export async function updatePersonalScheduleEntry(
  client: PersonalScheduleQueryClient,
  entryId: string,
  input: PersonalScheduleEntryInput,
): Promise<PlanningResult<PersonalScheduleEntry>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('personal_schedule_entries')
    .update({
      schedule_type: input.scheduleType,
      memo: input.memo,
      ...temporalToColumns(input.temporal),
    })
    .eq('id', entryId)
    .select()
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  if (data === null) {
    return deniedEntryUpdate();
  }
  return { ok: true, data: mapPersonalScheduleEntryRow(data) };
}

/** Every share row visible to the caller for one entry: the full recipient
 * list when the caller is the entry's owner, or just their own share row
 * when they are a recipient (personal_schedule_shares_select_owner_or_
 * recipient scopes it exactly that way). Paginated via fetchAllRows - see
 * listVisiblePersonalSchedule above. */
export async function listScheduleShares(
  client: PersonalScheduleQueryClient,
  scheduleEntryId: string,
): Promise<PlanningResult<ScheduleShare[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('personal_schedule_shares')
      .select('*', { count: 'exact' })
      .eq('schedule_entry_id', scheduleEntryId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: result.data.map(mapScheduleShareRow) };
}

/**
 * Message-text rules for public.share_schedule_entry_by_email's `raise
 * exception` calls (supabase/migrations/20260823020000_create_schedule_
 * share_email_boundary.sql, Issue #55). Unlike invitation's email-based RPC,
 * this one is not required to stay opaque about account existence - see
 * that migration's header - so "recipient email is not a registered
 * account" gets its own distinct kind rather than collapsing into a no-op.
 */
export const SHARE_BY_EMAIL_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  {
    test: (m) => m.includes('schedule entry and recipient email are required'),
    kind: 'validation',
  },
  {
    test: (m) => m.includes('only the schedule entry owner can add a recipient'),
    kind: 'permission-denied',
  },
  { test: (m) => m.includes('recipient email is not a valid email address'), kind: 'validation' },
  { test: (m) => m.includes('cannot share with yourself'), kind: 'validation' },
  { test: (m) => m.includes('recipient email is not a registered account'), kind: 'validation' },
];

/**
 * Shares an entry with a recipient identified by their exact registered
 * email address (Issue #55: MVP recipient targeting is exact email input,
 * not a user directory/search, and never a raw user id from a client).
 * Sharing takes effect immediately (no approval flow) and is idempotent -
 * re-sharing with an already-shared recipient returns the existing row
 * rather than erroring. Checks the caller's session first - see
 * updatePersonalScheduleEntry above for why.
 */
export async function shareScheduleEntryByEmail(
  client: PersonalScheduleQueryClient,
  scheduleEntryId: string,
  recipientEmail: string,
): Promise<PlanningResult<ScheduleShare>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client.rpc('share_schedule_entry_by_email', {
    p_schedule_entry_id: scheduleEntryId,
    p_recipient_email: recipientEmail,
  });
  if (error !== null) {
    return { ok: false, error: classifyRpcError(error, SHARE_BY_EMAIL_ERROR_RULES) };
  }
  return { ok: true, data: mapScheduleShareRow(data) };
}

/**
 * Message-text rules for public.list_schedule_share_recipient_emails's
 * `raise exception` calls (same migration as share_schedule_entry_by_email
 * above).
 */
export const LIST_SHARE_RECIPIENT_EMAILS_ERROR_RULES: readonly RpcErrorRule[] = [
  { test: (m) => m.includes('authentication required'), kind: 'unauthenticated' },
  {
    test: (m) => m.includes('only the schedule entry owner can view recipient emails'),
    kind: 'permission-denied',
  },
];

/**
 * The email of every recipient a schedule entry has actually been shared
 * with, for that entry's owner only (Issue #55: the bounded, owner-scoped
 * projection #37's recipient-removal UI needs - not a general user
 * directory, see public.list_schedule_share_recipient_emails's header). A
 * non-owner caller (including a recipient who is not the owner) gets
 * `permission-denied`, not an empty/`not-found` result, so a UI cannot
 * mistake "denied" for "nobody shared with yet". Checks the caller's
 * session first - see updatePersonalScheduleEntry above for why.
 *
 * Paginated via fetchAllRows, exactly like listVisiblePersonalSchedule and
 * listScheduleShares above: PostgREST caps a single RPC response at
 * supabase/config.toml's api.max_rows the same way it caps a plain table
 * read (client.rpc(...).range(...) hits the same limit
 * client.from(...).range(...) does), so an owner with more than max_rows
 * recipients on one entry would otherwise have this silently, and
 * indistinguishably from a genuinely short list, truncated.
 */
export async function listScheduleShareRecipientEmails(
  client: PersonalScheduleQueryClient,
  scheduleEntryId: string,
): Promise<PlanningResult<ScheduleShareRecipient[]>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const result = await fetchAllRows(
    (from, to) =>
      client
        .rpc(
          'list_schedule_share_recipient_emails',
          { p_schedule_entry_id: scheduleEntryId },
          { count: 'exact' },
        )
        .range(from, to),
    (error) => classifyRpcError(error, LIST_SHARE_RECIPIENT_EMAILS_ERROR_RULES),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: result.data.map(mapScheduleShareRecipientRow) };
}

/** Shares an entry with a recipient, as the entry's owner. Sharing takes
 * effect immediately (no approval flow). Checks the caller's session first
 * - see updatePersonalScheduleEntry above for why.
 *
 * Not used by any UI (Issue #55 PO decision): MVP recipient selection is
 * exact registered email input, never a raw id - see
 * shareScheduleEntryByEmail above, which is what the sharing UI calls. This
 * function remains as the Issue #33 typed boundary primitive.
 */
export async function shareScheduleEntry(
  client: PersonalScheduleQueryClient,
  scheduleEntryId: string,
  sharedWithUserId: string,
): Promise<PlanningResult<ScheduleShare>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('personal_schedule_shares')
    .insert({ schedule_entry_id: scheduleEntryId, shared_with_user_id: sharedWithUserId })
    .select()
    .single();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: mapScheduleShareRow(data) };
}

/**
 * Removes a share row - either the entry owner removing a recipient, or a
 * recipient removing themselves (self-leave); both are the same DELETE
 * policy (personal_schedule_shares_delete_owner_or_self), which is exactly
 * as wide as this table's SELECT policy. Unlike updatePersonalScheduleEntry
 * above, there is no "visible but not deletable" gap here, so a zero-rows
 * result is classified `not-found` rather than `permission-denied` -
 * matching domain/participation.ts's withdrawParticipation reasoning.
 * Checks the caller's session first - see updatePersonalScheduleEntry
 * above for why.
 */
export async function removeScheduleShare(
  client: PersonalScheduleQueryClient,
  shareId: string,
): Promise<PlanningResult<void>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('personal_schedule_shares')
    .delete()
    .eq('id', shareId)
    .select();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  if (data.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'not-found',
        message: 'schedule share was not found for this caller',
        code: 'delete-affected-no-rows',
      },
    };
  }
  return { ok: true, data: undefined };
}
