import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import { listEventOccurrences } from './eventCatalogRead.ts';
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventCatalogEvent,
  type EventOccurrence,
} from '../../domain/eventCatalog.ts';
import {
  classifyWriteError,
  type EventCatalogWriteResult,
  type EventDetailsInput,
  type EventCreateInput,
  type EventRangeInput,
  type OccurrenceInput,
} from '../../domain/eventCatalogWrite.ts';

// Typed feature-level write boundary over the shared event catalog (Issue
// #29), mirroring ./eventCatalogRead.ts's conventions: every function takes
// an already-constructed SupabaseClient<Database>, has no opinion on how it
// was created, and performs no permission judgment of its own. RLS, the
// column grants, and create_event_with_occurrence's designated-creator
// check are what actually enforce who may write what (see
// supabase/migrations/); this module only issues the request and reports
// the outcome faithfully.
//
// Faithful reporting is the substantive job here. A denied UPDATE is *not*
// an error at the PostgREST level: when RLS's USING clause filters the row
// out of the caller's visibility, the statement matches zero rows and
// returns success with empty data. Treating that as success would present
// a silently-discarded edit as a saved one - exactly the silent-failure
// mode docs/ux-ui.md forbids. Every update below therefore asks for the
// updated row back and treats its absence as a denial.

export type EventCatalogWriteClient = SupabaseClient<Database>;

/**
 * Zero rows returned by an update that RLS filtered out. Not a Postgres
 * error code (there is no error) - a synthetic code so callers and logs
 * can tell this apart from a real database error.
 */
const NOT_PERMITTED_OR_MISSING = 'update-affected-no-rows';

function deniedUpdate(subject: string): EventCatalogWriteResult<never> {
  return {
    ok: false,
    error: {
      kind: 'permission-denied',
      // Reads are open to every authenticated user, so a caller reaching
      // this point could see the row and still not change it - an
      // authority problem. A genuinely nonexistent id would look
      // identical, but is not reachable from a UI flow that loaded the
      // row first, so this is reported as the denial it is in practice
      // rather than as a generic failure.
      message: `${subject} was not updated: the row is not visible to this caller for update`,
      code: NOT_PERMITTED_OR_MISSING,
    },
  };
}

/**
 * Whether the *calling* user holds designated catalog creator membership.
 *
 * catalog_creators_select_own restricts this table to the caller's own
 * row, so this can only ever answer the question about the caller
 * themselves; `userId` is passed explicitly so the query states which
 * identity it is asserting about rather than relying on the policy alone.
 * A missing row is a definite "no" (`ok: true, data: false`), never
 * conflated with a read failure - a failure returns `ok: false`, so a
 * caller cannot accidentally render "you may not create events" when the
 * real problem was that the check could not be performed.
 */
export async function isDesignatedCatalogCreator(
  client: EventCatalogWriteClient,
  userId: string,
): Promise<EventCatalogWriteResult<boolean>> {
  const { data, error } = await client
    .from('catalog_creators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: data !== null };
}

/**
 * The only supported event-create path: one RPC call that persists the
 * event, its Event range, and an optional initial occurrence atomically,
 * derives owner_id from the caller (so the creator becomes the owner, with
 * no input surface for spoofing), and enforces designated-creator
 * membership server-side. initialOccurrence may be null (Issue #87/#88: an
 * event may have zero occurrences at create time).
 *
 * Unset optional fields are sent as `undefined` rather than `null`: the
 * function's parameters default to null, and PostgREST applies that
 * default only for arguments that are absent from the request body.
 */
export async function createEventWithInitialOccurrence(
  client: EventCatalogWriteClient,
  input: EventCreateInput,
): Promise<EventCatalogWriteResult<EventCatalogEvent>> {
  const { details, range, initialOccurrence } = input;
  const { data, error } = await client.rpc('create_event', {
    p_title: details.title,
    p_starts_on: range.startsOn,
    p_ends_on: range.endsOn,
    p_venue: details.venue ?? undefined,
    p_source_url: details.sourceUrl ?? undefined,
    p_memo: details.memo ?? undefined,
    p_starts_at: initialOccurrence?.startsAtUtc ?? undefined,
    p_ends_at: initialOccurrence?.endsAtUtc ?? undefined,
    p_doors_at: initialOccurrence?.doorsAtUtc ?? undefined,
  });
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: mapEventRow(data) };
}

/**
 * Updates an event's descriptive fields only. owner_id is deliberately
 * absent from the payload - it carries no UPDATE grant and RLS's WITH
 * CHECK would reject a change anyway, so ownership stays non-transferable
 * without this layer having to police it.
 */
export async function updateEventDetails(
  client: EventCatalogWriteClient,
  eventId: string,
  details: EventDetailsInput,
): Promise<EventCatalogWriteResult<EventCatalogEvent>> {
  const { data, error } = await client
    .from('events')
    .update({
      title: details.title,
      venue: details.venue,
      source_url: details.sourceUrl,
      memo: details.memo,
    })
    .eq('id', eventId)
    .select()
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  if (data === null) {
    return deniedUpdate('event');
  }
  return { ok: true, data: mapEventRow(data) };
}

/**
 * Adds a further occurrence to an existing event. Unlike an update, a
 * denied insert *is* a PostgREST error (RLS WITH CHECK failure, code
 * 42501), so there is no silent-zero-rows case to compensate for here.
 */
export async function addEventOccurrence(
  client: EventCatalogWriteClient,
  eventId: string,
  occurrence: OccurrenceInput,
): Promise<EventCatalogWriteResult<EventOccurrence>> {
  const { data, error } = await client
    .from('event_occurrences')
    .insert({
      event_id: eventId,
      doors_at: occurrence.doorsAtUtc,
      starts_at: occurrence.startsAtUtc,
      ends_at: occurrence.endsAtUtc,
    })
    .select()
    .single();
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: mapOccurrenceRow(data) };
}

/**
 * Updates an existing occurrence's times. event_id is deliberately absent
 * from the payload: reassigning an occurrence to a different event is not
 * a supported operation, and the column carries no UPDATE grant.
 */
export async function updateEventOccurrence(
  client: EventCatalogWriteClient,
  occurrenceId: string,
  occurrence: OccurrenceInput,
): Promise<EventCatalogWriteResult<EventOccurrence>> {
  const { data, error } = await client
    .from('event_occurrences')
    .update({
      doors_at: occurrence.doorsAtUtc,
      starts_at: occurrence.startsAtUtc,
      ends_at: occurrence.endsAtUtc,
    })
    .eq('id', occurrenceId)
    .select()
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  if (data === null) {
    return deniedUpdate('occurrence');
  }
  return { ok: true, data: mapOccurrenceRow(data) };
}

/**
 * Moves an event's Event range, atomically with its existing occurrences
 * (Issue #87/#88's reschedule boundary - product-rules.md "Mutable /
 * system-managed fields"). Every occurrence currently under the event is
 * carried in the payload unchanged (identified by its immutable id, not by
 * starts_at) unless the caller is deliberately moving one - this is what
 * lets a plain "edit the Event range" submission and a full reschedule (the
 * range and its occurrences moving together) share the same write path:
 * widening or narrowing a range that still contains every occurrence's
 * unchanged time succeeds the same way a genuine reschedule does, just with
 * nothing in the occurrence payload actually different from what was
 * already persisted.
 *
 * A narrower range that would exclude an occurrence neither this call nor
 * a prior one has moved out of the way is rejected by
 * events_range_contains_occurrences at commit, same as any other
 * containment violation - reschedule_event does not bypass the invariant,
 * it only defers *when* it is checked within this one call.
 */
export async function rescheduleEvent(
  client: EventCatalogWriteClient,
  eventId: string,
  range: EventRangeInput,
  occurrences: readonly { id: string; occurrence: OccurrenceInput }[],
): Promise<EventCatalogWriteResult<EventOccurrence[]>> {
  const { data, error } = await client.rpc('reschedule_event', {
    p_event_id: eventId,
    p_starts_on: range.startsOn,
    p_ends_on: range.endsOn,
    p_occurrences: occurrences.map(({ id, occurrence }) => ({
      id,
      doorsAt: occurrence.doorsAtUtc,
      startsAt: occurrence.startsAtUtc,
      endsAt: occurrence.endsAtUtc,
    })),
  });
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: data.map(mapOccurrenceRow) };
}

/**
 * The MVP Event range edit action: moves only the range, carrying every
 * existing occurrence through rescheduleEvent unchanged (see that
 * function's comment for why passing them unchanged still goes through the
 * same atomic path rather than a plain events UPDATE). Fetches the current
 * occurrence set itself rather than trusting a client-submitted list, so a
 * stale or tampered form submission cannot silently drop an occurrence from
 * the reschedule payload.
 *
 * A genuine reschedule - the range and one or more occurrence times moving
 * together - is not a distinct screen: an owner widens the range here first
 * if needed, moves the affected occurrences through the existing per-
 * occurrence edit form (safe once they are inside the wider range), then
 * narrows the range back down here. Each of those three steps is
 * independently valid under the containment invariant, so no dedicated
 * combined-edit UI is needed for it.
 */
export async function updateEventRange(
  client: EventCatalogWriteClient,
  eventId: string,
  range: EventRangeInput,
): Promise<EventCatalogWriteResult<EventCatalogEvent>> {
  const occurrencesResult = await listEventOccurrences(client, eventId);
  if (!occurrencesResult.ok) {
    return { ok: false, error: classifyWriteError(occurrencesResult.error) };
  }

  const payload = occurrencesResult.data.map((occurrence) => ({
    id: occurrence.id,
    occurrence: {
      doorsAtUtc: occurrence.doorsAt,
      startsAtUtc: occurrence.startsAt,
      endsAtUtc: occurrence.endsAt,
    },
  }));

  const rescheduleResult = await rescheduleEvent(client, eventId, range, payload);
  if (!rescheduleResult.ok) {
    return rescheduleResult;
  }

  const { data: eventRow, error } = await client
    .from('events')
    .select()
    .eq('id', eventId)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  if (eventRow === null) {
    return deniedUpdate('event');
  }
  return { ok: true, data: mapEventRow(eventRow) };
}

/**
 * Hard delete an event occurrence (Issue #124). Calls the delete_event_occurrence
 * RPC which enforces owner-only access, checks for downstream participation/
 * invitation/ticket-acquisition data, and raises custom SQLSTATE '90001' if
 * blocked by downstream data. The RPC itself is SECURITY DEFINER so raw
 * DELETE access is never exposed to authenticated clients - this is the only
 * path to delete an occurrence.
 */
export async function deleteEventOccurrence(
  client: EventCatalogWriteClient,
  occurrenceId: string,
): Promise<EventCatalogWriteResult<void>> {
  const { error } = await client.rpc('delete_event_occurrence', {
    p_occurrence_id: occurrenceId,
  });
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: undefined };
}

/**
 * Hard delete an event and all its child occurrences (Issue #124). Calls the
 * delete_event RPC which enforces: owner-only access, all child occurrences
 * must be safe to delete (no downstream participation/invitation/
 * ticket-acquisition), and atomic deletion of event + all children. The RPC
 * raises custom SQLSTATE '90001' if any child has downstream data or if the
 * event itself is not found/owned.
 */
export async function deleteEvent(
  client: EventCatalogWriteClient,
  eventId: string,
): Promise<EventCatalogWriteResult<void>> {
  const { error } = await client.rpc('delete_event', { p_event_id: eventId });
  if (error !== null) {
    return { ok: false, error: classifyWriteError(error) };
  }
  return { ok: true, data: undefined };
}
