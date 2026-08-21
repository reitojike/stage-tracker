// Shared event catalog read model (Issue #12).
//
// Product semantics (see .ai-dev-foundation/product-rules.md "Event
// catalog" / "Event と公演回" sections, approved by Issue #13 and
// materialized as schema/RLS by Issue #17):
// - An event (興行) has one or more occurrences (公演回); temporal data
//   (starts_at / ends_at) lives on the occurrence, never on the event.
// - ends_at may be unset (unknown end time) - this is a valid state, never
//   coerced to a default.
// - The product date boundary is Asia/Tokyo; persisted timestamps are
//   PostgreSQL timestamptz (i.e. UTC instants over the wire).
//
// This module is pure domain logic: no Supabase/DB import, so it is usable
// and testable from anywhere without pulling infrastructure in (see the
// architecture import boundary in eslint.config.mjs).

export interface EventCatalogEvent {
  id: string;
  ownerId: string;
  title: string;
  venue: string | null;
  sourceUrl: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventOccurrence {
  id: string;
  eventId: string;
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventWithOccurrences {
  event: EventCatalogEvent;
  occurrences: EventOccurrence[];
}

/**
 * The persistence row shapes mapEventRow/mapOccurrenceRow expect.
 * Structurally match public.events / public.event_occurrences (see the
 * generated Database type), declared locally rather than importing it, so
 * this module stays free of an infrastructure dependency - the same
 * narrow-interface convention src/infrastructure/supabase/magicLink.ts uses
 * for MagicLinkAuthClient.
 */
export interface RawEventRow {
  id: string;
  owner_id: string;
  title: string;
  venue: string | null;
  source_url: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawEventOccurrenceRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export function mapEventRow(row: RawEventRow): EventCatalogEvent {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    venue: row.venue,
    sourceUrl: row.source_url,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** ends_at is passed through as-is: an unknown end time (null) is a valid
 * state, never coerced to a default. */
export function mapOccurrenceRow(row: RawEventOccurrenceRow): EventOccurrence {
  return {
    id: row.id,
    eventId: row.event_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Deterministic occurrence ordering: starts_at ascending is the product
 * requirement (product-rules.md "Catalog の日程参照要件"). id is a stable
 * tie-breaker for occurrences that share the same starts_at, so same-day
 * (or same-instant) multiple occurrences never depend on undefined DB row
 * order.
 */
export function compareOccurrencesByStartsAt(a: EventOccurrence, b: EventOccurrence): number {
  if (a.startsAt !== b.startsAt) {
    return a.startsAt < b.startsAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function sortOccurrences(occurrences: readonly EventOccurrence[]): EventOccurrence[] {
  return [...occurrences].sort(compareOccurrencesByStartsAt);
}

/**
 * Attaches each occurrence to its parent event, preserving the order of
 * `events` (the caller decides that ordering - e.g. by created_at) and
 * emitting every event exactly once, even one with no occurrences at all
 * (which the product invariant "an event has >= 1 occurrence" should
 * prevent, but this function does not assume that holds). Occurrences
 * within each event are sorted deterministically. Used for whole-catalog /
 * single-event reads, where the event set itself is already known.
 */
export function attachOccurrencesToEvents(
  events: readonly EventCatalogEvent[],
  occurrences: readonly EventOccurrence[],
): EventWithOccurrences[] {
  const byEventId = new Map<string, EventOccurrence[]>();
  for (const occurrence of occurrences) {
    const bucket = byEventId.get(occurrence.eventId);
    if (bucket) {
      bucket.push(occurrence);
    } else {
      byEventId.set(occurrence.eventId, [occurrence]);
    }
  }
  return events.map((event) => ({
    event,
    occurrences: sortOccurrences(byEventId.get(event.id) ?? []),
  }));
}

/**
 * Groups occurrences under their parent event, ordering the *events* in
 * the output by the first (chronologically earliest, since `occurrences`
 * is expected pre-sorted or is re-sorted before grouping) occurrence
 * encountered - i.e. by soonest occurrence. Only events with at least one
 * occurrence present in `occurrences` appear in the output: used for
 * period/day-scoped reads, where "no occurrence in range" must mean the
 * event is simply absent from the result, not fabricated as an empty
 * entry.
 */
export function groupOccurrencesByEvent(
  events: readonly EventCatalogEvent[],
  occurrences: readonly EventOccurrence[],
): EventWithOccurrences[] {
  const eventsById = new Map(events.map((event) => [event.id, event] as const));
  const sorted = sortOccurrences(occurrences);

  const order: string[] = [];
  const byEventId = new Map<string, EventOccurrence[]>();
  for (const occurrence of sorted) {
    const bucket = byEventId.get(occurrence.eventId);
    if (bucket) {
      bucket.push(occurrence);
    } else {
      byEventId.set(occurrence.eventId, [occurrence]);
      order.push(occurrence.eventId);
    }
  }

  const result: EventWithOccurrences[] = [];
  for (const eventId of order) {
    const event = eventsById.get(eventId);
    const bucket = byEventId.get(eventId);
    if (event !== undefined && bucket !== undefined) {
      result.push({ event, occurrences: bucket });
    }
  }
  return result;
}

/** Half-open instant range `[startUtc, endUtcExclusive)`, both ISO 8601 UTC. */
export interface UtcInstantRange {
  startUtc: string;
  endUtcExclusive: string;
}

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

function parseTokyoCalendarDate(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`expected an Asia/Tokyo calendar date as "YYYY-MM-DD", got: ${dateStr}`);
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error(`expected an Asia/Tokyo calendar date as "YYYY-MM-DD", got: ${dateStr}`);
  }
  return { year: Number(yearStr), month: Number(monthStr), day: Number(dayStr) };
}

/**
 * Asia/Tokyo has a fixed UTC+9 offset with no DST, so a Tokyo calendar
 * day's boundaries are plain arithmetic rather than requiring a timezone
 * database/library. Tokyo 00:00 on `dateStr` is the UTC instant
 * `dateStr 00:00 - 9h`; the returned range is half-open so callers can
 * express "occurred on this day" as
 * `startsAt >= startUtc AND startsAt < endUtcExclusive` without either
 * double-counting or dropping a boundary instant. This does not read the
 * JS runtime's local timezone or the DB session timezone - the offset is a
 * fixed constant.
 */
export function tokyoCalendarDayRangeUtc(dateStr: string): UtcInstantRange {
  const { year, month, day } = parseTokyoCalendarDate(dateStr);
  const startMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - TOKYO_OFFSET_MS;
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtcExclusive: new Date(endMs).toISOString(),
  };
}

/**
 * Half-open range covering every Tokyo calendar day from `startDateStr`
 * through `endDateStrInclusive` (both "YYYY-MM-DD"), e.g. a month: pass
 * that month's first and last day. The end bound is the following Tokyo
 * calendar day's start, so an occurrence exactly at that instant (which
 * belongs to the next day) is correctly excluded.
 */
export function tokyoCalendarDateRangeUtc(
  startDateStr: string,
  endDateStrInclusive: string,
): UtcInstantRange {
  const { startUtc } = tokyoCalendarDayRangeUtc(startDateStr);
  const { endUtcExclusive } = tokyoCalendarDayRangeUtc(endDateStrInclusive);
  return { startUtc, endUtcExclusive };
}

/**
 * Discriminated success/error result so a caller can branch on outcome
 * without receiving a raw Supabase/Postgrest error type. `data` on the
 * `ok: true` branch may legitimately be an empty array/null - that is a
 * valid empty result, not an error.
 */
export type EventCatalogReadResult<T> =
  { ok: true; data: T } | { ok: false; error: EventCatalogReadError };

export interface EventCatalogReadError {
  message: string;
  code: string;
}

/** The minimal shape of a Postgrest/Supabase query error this module maps
 * from - narrowed the same way RawEventRow narrows a persistence row,
 * rather than importing PostgrestError from the Supabase SDK. */
export interface RawPostgrestError {
  message: string;
  code: string;
}

export function mapPostgrestError(error: RawPostgrestError): EventCatalogReadError {
  return { message: error.message, code: error.code };
}
