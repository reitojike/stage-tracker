import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  attachOccurrencesToEvents,
  groupOccurrencesByEvent,
  mapEventRow,
  mapOccurrenceRow,
  mapPostgrestError,
  sortOccurrences,
  tokyoCalendarDayRangeUtc,
  type EventCatalogReadResult,
  type EventOccurrence,
  type EventWithOccurrences,
  type UtcInstantRange,
} from '../../domain/eventCatalog.ts';

// Typed feature-level read boundary over the shared event catalog (Issue
// #12). Every function here takes an already-constructed
// SupabaseClient<Database> - it has no opinion on how that client was
// created, and never imports an auth provider, cookie handling, or session
// lifecycle (see src/infrastructure/supabase/browserClient.ts /
// serverClient.ts / session.ts for those, which this module does not
// touch). RLS (see supabase/migrations/20260820000000_create_events.sql and
// 20260821000000_create_event_occurrences.sql) is what actually enforces
// who may read what; this module performs no additional application-side
// filtering that could substitute for it - an anonymous/unauthorized client
// gets the DB's own permission error back through EventCatalogReadResult,
// not a silently-empty result.
//
// Row-to-domain mapping, occurrence ordering, and Asia/Tokyo date-range
// arithmetic all live in ../../domain/eventCatalog.ts as pure functions;
// this module only builds queries and wires their results through those
// functions.

export type EventCatalogQueryClient = SupabaseClient<Database>;

/**
 * The whole shared catalog: every event with its occurrences, events
 * ordered by created_at (registration order) as the minimal deterministic
 * default, occurrences within each event ordered per
 * domain/eventCatalog.ts's compareOccurrencesByStartsAt.
 */
export async function listEventCatalog(
  client: EventCatalogQueryClient,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  const { data: eventRows, error: eventsError } = await client
    .from('events')
    .select()
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (eventsError !== null) {
    return { ok: false, error: mapPostgrestError(eventsError) };
  }

  const { data: occurrenceRows, error: occurrencesError } = await client
    .from('event_occurrences')
    .select();
  if (occurrencesError !== null) {
    return { ok: false, error: mapPostgrestError(occurrencesError) };
  }

  const events = eventRows.map(mapEventRow);
  const occurrences = occurrenceRows.map(mapOccurrenceRow);
  return { ok: true, data: attachOccurrencesToEvents(events, occurrences) };
}

/**
 * Events with at least one occurrence in the half-open instant range
 * `[range.startUtc, range.endUtcExclusive)`. Only the occurrences that
 * actually fall in range are included (an event's occurrences outside the
 * range are not attached), and an event with none in range is simply
 * absent from the result - never fabricated as an empty entry. Result
 * ordering follows each event's soonest in-range occurrence.
 */
export async function listEventCatalogInRange(
  client: EventCatalogQueryClient,
  range: UtcInstantRange,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  const { data: occurrenceRows, error: occurrencesError } = await client
    .from('event_occurrences')
    .select()
    .gte('starts_at', range.startUtc)
    .lt('starts_at', range.endUtcExclusive)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true });
  if (occurrencesError !== null) {
    return { ok: false, error: mapPostgrestError(occurrencesError) };
  }
  if (occurrenceRows.length === 0) {
    return { ok: true, data: [] };
  }

  const occurrences = occurrenceRows.map(mapOccurrenceRow);
  const eventIds = [...new Set(occurrences.map((occurrence) => occurrence.eventId))];

  const { data: eventRows, error: eventsError } = await client
    .from('events')
    .select()
    .in('id', eventIds);
  if (eventsError !== null) {
    return { ok: false, error: mapPostgrestError(eventsError) };
  }

  const events = eventRows.map(mapEventRow);
  return { ok: true, data: groupOccurrencesByEvent(events, occurrences) };
}

/**
 * Events with an occurrence on the given Asia/Tokyo calendar day
 * ("YYYY-MM-DD"), and that day's occurrence times - a thin convenience
 * wrapper over listEventCatalogInRange using the Tokyo day boundary.
 */
export async function listEventCatalogOnDate(
  client: EventCatalogQueryClient,
  tokyoDate: string,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  return listEventCatalogInRange(client, tokyoCalendarDayRangeUtc(tokyoDate));
}

/** A single event's occurrences, ordered deterministically by starts_at. */
export async function listEventOccurrences(
  client: EventCatalogQueryClient,
  eventId: string,
): Promise<EventCatalogReadResult<EventOccurrence[]>> {
  const { data, error } = await client
    .from('event_occurrences')
    .select()
    .eq('event_id', eventId)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true });
  if (error !== null) {
    return { ok: false, error: mapPostgrestError(error) };
  }
  return { ok: true, data: sortOccurrences(data.map(mapOccurrenceRow)) };
}

/**
 * A single event and its occurrences. `data: null` (not an error) means no
 * event exists with that id.
 */
export async function getEventWithOccurrences(
  client: EventCatalogQueryClient,
  eventId: string,
): Promise<EventCatalogReadResult<EventWithOccurrences | null>> {
  const { data: eventRow, error: eventError } = await client
    .from('events')
    .select()
    .eq('id', eventId)
    .maybeSingle();
  if (eventError !== null) {
    return { ok: false, error: mapPostgrestError(eventError) };
  }
  if (eventRow === null) {
    return { ok: true, data: null };
  }

  const occurrencesResult = await listEventOccurrences(client, eventId);
  if (!occurrencesResult.ok) {
    return occurrencesResult;
  }

  return {
    ok: true,
    data: { event: mapEventRow(eventRow), occurrences: occurrencesResult.data },
  };
}
