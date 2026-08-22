import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  mapParticipationRow,
  sortParticipations,
  type Participation,
  type ParticipationInput,
} from '../../domain/participation.ts';
import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';
import { fetchAllRows } from './pagedFetch.ts';
import { requireAuthenticatedUserId } from './planningAuth.ts';

// Typed feature-level read/write boundary over public.occurrence_participations
// (Issue #33). Every function takes an already-constructed
// SupabaseClient<Database> and performs no permission judgment of its own -
// RLS (occurrence_participations_select_visible / _insert_own / _update_own /
// _delete_own, see supabase/migrations/20260822010000_create_occurrence_
// participations.sql) is what actually enforces who may read/write what.
//
// Every "my own" operation below resolves the caller's id from the client's
// own session (requireAuthenticatedUserId) rather than taking it as a
// parameter, so a missing/expired session is reported as `unauthenticated`
// by this boundary itself, and a caller of this module can never populate
// user_id with anyone but whoever the client is actually signed in as.
//
// Zero-rows-affected classification for withdrawParticipation below:
// occurrence_participations_delete_own already restricts DELETE to
// user_id = auth.uid(), and the query itself additionally filters by the
// resolved caller id before RLS is ever consulted. So a zero-rows result
// there cannot mean "visible but not yours" (that case is excluded by the
// query's own filter, not merely by RLS) - it can only mean no such
// participation row exists for this id under this caller, which `not-found`
// describes exactly. This is the opposite shape from domain/
// eventCatalogWrite.ts's deniedUpdate, which reports `permission-denied` for
// events precisely because that module does *not* pre-filter by owner - its
// SELECT policy is open to every authenticated user, so a caller reaching
// that point could see the row and still lack authority over it.

export type ParticipationQueryClient = SupabaseClient<Database>;

const NOT_FOUND_FOR_CALLER = 'delete-affected-no-rows';

function notFoundForCaller(subject: string): PlanningResult<never> {
  return {
    ok: false,
    error: {
      kind: 'not-found',
      message: `${subject} was not found for this caller`,
      code: NOT_FOUND_FOR_CALLER,
    },
  };
}

/** The caller's own participation for one occurrence, or `data: null` (not
 * an error) when they have none yet. */
export async function getMyParticipation(
  client: ParticipationQueryClient,
  occurrenceId: string,
): Promise<PlanningResult<Participation | null>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('occurrence_participations')
    .select()
    .eq('occurrence_id', occurrenceId)
    .eq('user_id', callerId.data)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  return { ok: true, data: data === null ? null : mapParticipationRow(data) };
}

/** Every participation the caller themselves recorded, across all
 * occurrences - the read a personal calendar journey needs. Paginated via
 * fetchAllRows so a caller with more rows than PostgREST's api.max_rows
 * never silently loses the rest (see pagedFetch.ts). */
export async function listMyParticipations(
  client: ParticipationQueryClient,
): Promise<PlanningResult<Participation[]>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const result = await fetchAllRows((from, to) =>
    client
      .from('occurrence_participations')
      .select('*', { count: 'exact' })
      .eq('user_id', callerId.data)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortParticipations(result.data.map(mapParticipationRow)) };
}

/** Every participation visible to the caller for one occurrence: their own
 * (any visibility) plus every other user's `public` row - exactly what
 * occurrence_participations_select_visible allows through. Needs no caller
 * id: RLS alone decides what this query returns. Paginated via
 * fetchAllRows - see listMyParticipations above. */
export async function listVisibleParticipationsForOccurrence(
  client: ParticipationQueryClient,
  occurrenceId: string,
): Promise<PlanningResult<Participation[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('occurrence_participations')
      .select('*', { count: 'exact' })
      .eq('occurrence_id', occurrenceId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortParticipations(result.data.map(mapParticipationRow)) };
}

/**
 * Records the caller's own participation for an occurrence: updates
 * status/visibility if a row already exists, or inserts one if not -
 * "set my participation to X" regardless of which case applies.
 *
 * Not a single `.upsert()`: PostgREST's ON CONFLICT DO UPDATE always sets
 * *every* column in the submitted payload, including occurrence_id and
 * user_id - which carry no UPDATE grant (occurrence_participations_
 * insert_own/_update_own are INSERT-only for those columns, see
 * supabase/migrations/20260822010000_create_occurrence_participations.sql).
 * A real upsert against this table therefore always fails with 42501,
 * regardless of whether a row exists yet. Updating first, and inserting
 * only when that affects no row, keeps every write within its actual grant.
 *
 * The gap between "update matched nothing" and the insert below is a real
 * race window: a concurrent call for the same (occurrence, user) can land
 * its insert first, which surfaces here as a unique_violation on
 * occurrence_participations_occurrence_user_key. That is recovered by
 * retrying the update once, onto the row the other call just created,
 * rather than surfacing a spurious conflict for an operation that is
 * conceptually just "set my own participation".
 */
export async function setParticipation(
  client: ParticipationQueryClient,
  occurrenceId: string,
  input: ParticipationInput,
): Promise<PlanningResult<Participation>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }
  const callerUserId = callerId.data;

  const patch: Database['public']['Tables']['occurrence_participations']['Update'] = {
    status: input.status,
  };
  if (input.visibility !== undefined) {
    patch.visibility = input.visibility;
  }

  async function tryUpdate(): Promise<PlanningResult<Participation> | null> {
    const { data, error } = await client
      .from('occurrence_participations')
      .update(patch)
      .eq('occurrence_id', occurrenceId)
      .eq('user_id', callerUserId)
      .select()
      .maybeSingle();
    if (error !== null) {
      return { ok: false, error: classifyPostgrestError(error) };
    }
    return data === null ? null : { ok: true, data: mapParticipationRow(data) };
  }

  const updated = await tryUpdate();
  if (updated !== null) {
    return updated;
  }

  const insertRow: Database['public']['Tables']['occurrence_participations']['Insert'] = {
    occurrence_id: occurrenceId,
    user_id: callerUserId,
    status: input.status,
  };
  if (input.visibility !== undefined) {
    insertRow.visibility = input.visibility;
  }

  const { data, error } = await client
    .from('occurrence_participations')
    .insert(insertRow)
    .select()
    .single();
  if (error === null) {
    return { ok: true, data: mapParticipationRow(data) };
  }
  if (error.code !== '23505') {
    return { ok: false, error: classifyPostgrestError(error) };
  }

  // Lost the race: someone else's insert landed first. Their row now
  // exists, so the update this caller actually asked for can proceed.
  const retried = await tryUpdate();
  if (retried !== null) {
    return retried;
  }
  return {
    ok: false,
    error: {
      kind: 'failure',
      message: 'participation could not be set after a concurrent write',
      code: 'concurrent-write-unresolved',
    },
  };
}

/**
 * Withdraws the caller's own participation - row removal is the canonical
 * representation of "not participating" (product-rules.md: no
 * `not_attending` status). Scoped to the caller's own user_id in the query
 * itself (not just relying on RLS), so this can never even attempt to
 * remove someone else's row.
 */
export async function withdrawParticipation(
  client: ParticipationQueryClient,
  participationId: string,
): Promise<PlanningResult<void>> {
  const callerId = await requireAuthenticatedUserId(client);
  if (!callerId.ok) {
    return callerId;
  }

  const { data, error } = await client
    .from('occurrence_participations')
    .delete()
    .eq('id', participationId)
    .eq('user_id', callerId.data)
    .select();
  if (error !== null) {
    return { ok: false, error: classifyPostgrestError(error) };
  }
  if (data.length === 0) {
    return notFoundForCaller('participation');
  }
  return { ok: true, data: undefined };
}
