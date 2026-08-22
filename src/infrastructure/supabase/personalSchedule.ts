import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapPersonalScheduleEntryRow,
  mapScheduleShareRow,
  sortPersonalScheduleEntries,
  temporalToColumns,
  type PersonalScheduleEntry,
  type PersonalScheduleEntryInput,
  type ScheduleShare,
} from '../../domain/personalSchedule.ts';
import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';
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

/** Shares an entry with a recipient, as the entry's owner. Sharing takes
 * effect immediately (no approval flow). Checks the caller's session first
 * - see updatePersonalScheduleEntry above for why. */
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
