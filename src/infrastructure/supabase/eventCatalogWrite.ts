import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
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
 * event and its required initial occurrence atomically, derives owner_id
 * from the caller (so the creator becomes the owner, with no input surface
 * for spoofing), and enforces designated-creator membership server-side.
 *
 * Unset optional fields are sent as `undefined` rather than `null`: the
 * function's parameters default to null, and PostgREST applies that
 * default only for arguments that are absent from the request body.
 */
export async function createEventWithInitialOccurrence(
  client: EventCatalogWriteClient,
  input: EventCreateInput,
): Promise<EventCatalogWriteResult<EventCatalogEvent>> {
  const { details, initialOccurrence } = input;
  const { data, error } = await client.rpc('create_event_with_occurrence', {
    p_title: details.title,
    p_starts_at: initialOccurrence.startsAtUtc,
    p_venue: details.venue ?? undefined,
    p_ends_at: initialOccurrence.endsAtUtc ?? undefined,
    p_source_url: details.sourceUrl ?? undefined,
    p_memo: details.memo ?? undefined,
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
    .update({ starts_at: occurrence.startsAtUtc, ends_at: occurrence.endsAtUtc })
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
