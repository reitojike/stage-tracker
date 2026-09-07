import type { TestActor } from './testActors.ts';
import { postgrestFetchAs } from './postgrest.ts';

// Direct authenticated INSERT into events is unsupported (Issue #17): the
// only supported create paths are the create_event / import_event_with_occurrences
// RPCs. This is the shared fixture helper for tests that need an existing
// event and don't care about the create path itself.
//
// create_event (Issue #88, renamed from create_event_with_occurrence) now
// requires an Event range (starts_on/ends_on) and makes the initial
// occurrence optional. Kept deliberately self-contained (no import from
// src/domain) like the rest of this support directory - Asia/Tokyo has a
// fixed +09:00 offset with no DST, so deriving a default calendar-date
// range around an instant is safe as plain arithmetic here too.

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

function tokyoCalendarDate(instantIso: string): string {
  const tokyo = new Date(Date.parse(instantIso) + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface EventFixtureOverrides {
  title?: string;
  startsAt?: string;
  endsAt?: string;
  doorsAt?: string;
  venue?: string;
  sourceUrl?: string;
  memo?: string;
  /** Defaults to the fixture occurrence's own Tokyo calendar date when an
   * occurrence is created; required (no default) for a 0-occurrence
   * fixture (see createEventWithoutOccurrence below). */
  startsOn?: string;
  endsOn?: string;
}

export function eventFixtureTitle(): string {
  return `rls test event ${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

export async function createEventWithOccurrence(
  actor: TestActor,
  overrides: EventFixtureOverrides = {},
) {
  const startsAt = overrides.startsAt ?? new Date().toISOString();
  const occurrenceDate = tokyoCalendarDate(startsAt);
  const { data: event, error } = await actor.client.rpc('create_event', {
    p_title: overrides.title ?? eventFixtureTitle(),
    p_starts_on: overrides.startsOn ?? occurrenceDate,
    p_ends_on: overrides.endsOn ?? occurrenceDate,
    p_venue: overrides.venue,
    p_source_url: overrides.sourceUrl,
    p_memo: overrides.memo,
    p_starts_at: startsAt,
    p_ends_at: overrides.endsAt,
    p_doors_at: overrides.doorsAt,
  });
  if (error) {
    throw new Error(`fixture create_event failed: ${error.message}`);
  }

  const { data: occurrences, error: occurrencesError } = await actor.client
    .from('event_occurrences')
    .select()
    .eq('event_id', event.id);
  if (occurrencesError) {
    throw new Error(
      `fixture event ${event.id} failed to fetch its occurrence: ${occurrencesError.message}`,
    );
  }
  if (occurrences.length !== 1) {
    throw new Error(
      `fixture event ${event.id} expected exactly one occurrence, found ${String(occurrences.length)}`,
    );
  }
  const [occurrence] = occurrences;
  if (!occurrence) {
    throw new Error(`fixture event ${event.id} occurrence row was missing after the count check`);
  }

  return { event, occurrence };
}

/**
 * A 0-occurrence event fixture (Issue #87/#88): createEventWithOccurrence
 * above cannot express this (it always supplies startsAt), so callers that
 * need to test the range-visibility/0-occurrence-create surface use this
 * instead. startsOn/endsOn are required - there is no occurrence to derive
 * a default range from.
 */
export async function createEventWithoutOccurrence(
  actor: TestActor,
  startsOn: string,
  endsOn: string,
  overrides: Omit<
    EventFixtureOverrides,
    'startsAt' | 'endsAt' | 'doorsAt' | 'startsOn' | 'endsOn'
  > = {},
) {
  const { data: event, error } = await actor.client.rpc('create_event', {
    p_title: overrides.title ?? eventFixtureTitle(),
    p_starts_on: startsOn,
    p_ends_on: endsOn,
    p_venue: overrides.venue,
    p_source_url: overrides.sourceUrl,
    p_memo: overrides.memo,
  });
  if (error) {
    throw new Error(`fixture create_event (zero-occurrence) failed: ${error.message}`);
  }
  return { event };
}

/**
 * Calls create_event over raw HTTP with an arbitrary JSON body, bypassing
 * the generated Functions Args type entirely. Used only for negative tests
 * that need to send a request shape the typed `actor.client.rpc(...)` call
 * structurally cannot express (e.g. omitting a required parameter) - proving
 * server-side enforcement rather than client-side type-system enforcement.
 */
export async function callCreateEventRpcRaw(
  actor: TestActor,
  body: Record<string, unknown>,
): Promise<Response> {
  return postgrestFetchAs(actor, 'rest/v1/rpc/create_event', body);
}
