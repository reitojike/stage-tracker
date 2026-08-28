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
  /** Asia/Tokyo calendar date ("YYYY-MM-DD"), both inclusive - the
   * officially published 初日〜千秋楽, independent of whatever occurrence
   * rows exist (Issue #87/#88). */
  startsOn: string;
  endsOn: string;
  /** Event-level cancellation (Issue #125/#123): null = active, non-null =
   * canceled. Composes with EventOccurrence.canceledAt via OR - see
   * domain/eventCancellation.ts's isEffectivelyCanceled - never derived
   * from occurrence state. */
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventOccurrence {
  id: string;
  eventId: string;
  /** 開場 (Issue #88), nullable - an unpublished doors time is a valid
   * state, same treatment as endsAt. */
  doorsAt: string | null;
  startsAt: string;
  endsAt: string | null;
  /** Occurrence-level cancellation (Issue #125/#123): null = active,
   * non-null = canceled. Independent of the parent Event's own
   * canceledAt - un-canceling the Event never clears this. */
  canceledAt: string | null;
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
  starts_on: string;
  ends_on: string;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawEventOccurrenceRow {
  id: string;
  event_id: string;
  doors_at: string | null;
  starts_at: string;
  ends_at: string | null;
  canceled_at: string | null;
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
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** ends_at/doors_at are passed through as-is: an unknown end/doors time
 * (null) is a valid state, never coerced to a default. */
export function mapOccurrenceRow(row: RawEventOccurrenceRow): EventOccurrence {
  return {
    id: row.id,
    eventId: row.event_id,
    doorsAt: row.doors_at,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    canceledAt: row.canceled_at,
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

/** Asia/Tokyo has a fixed UTC+9 offset, no DST - exported so other domain
 * modules (e.g. catalogFormatting.ts) that need to shift a UTC instant into
 * Tokyo local fields do not redefine this constant themselves. */
export const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Parses a "YYYY-MM-DD" calendar date, rejecting anything that is only
 * shape-valid (e.g. "2026-13-01", "2026-02-30", or a 2-digit year that
 * would trigger JS's legacy Date.UTC 1900s remap) via a Date.UTC round-trip
 * - see the comment below. Exported so other domain modules that need the
 * same validated calendar-date parsing (e.g. calendarMonth.ts's month-grid
 * arithmetic) share this instead of re-deriving their own, weaker,
 * shape-only check.
 */
export function parseTokyoCalendarDate(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`expected an Asia/Tokyo calendar date as "YYYY-MM-DD", got: ${dateStr}`);
  }
  const [, yearStr, monthStr, dayStr] = match;
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new Error(`expected an Asia/Tokyo calendar date as "YYYY-MM-DD", got: ${dateStr}`);
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  // The regex only checks digit-grouping shape, not that month/day are a
  // real calendar date: Date.UTC silently normalizes out-of-range
  // components (e.g. month 13, or day 30 in February rolling into March)
  // instead of erroring, which would otherwise compute a boundary for a
  // different day/month than the caller wrote. Round-tripping through
  // Date.UTC and comparing the components back out catches that.
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new Error(`"${dateStr}" is not a valid Asia/Tokyo calendar date`);
  }

  return { year, month, day };
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
 * The inverse of tokyoCalendarDayRangeUtc: which Asia/Tokyo calendar day
 * ("YYYY-MM-DD") a UTC instant falls on. Used to bucket occurrences by
 * Tokyo calendar day for presentation (e.g. month calendar rendering),
 * without ever reading the JS runtime's local timezone - Tokyo has a fixed
 * UTC+9 offset with no DST, so shifting the instant by that fixed constant
 * and reading its UTC calendar fields back out is exact.
 */
export function tokyoCalendarDateFromInstant(instantIso: string): string {
  const tokyo = tokyoLocalInstant(instantIso);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Shifts a UTC instant by the fixed Asia/Tokyo offset and returns it as a
 * Date whose UTC getters (getUTCFullYear/getUTCMonth/getUTCDate/getUTCHours/
 * getUTCMinutes/...) then read as Tokyo local fields. Exported so any
 * domain module that needs Tokyo local fields (not just the calendar date -
 * see catalogFormatting.ts's time-of-day labels) shares this one
 * parse+shift instead of re-deriving it.
 */
export function tokyoLocalInstant(instantIso: string): Date {
  const instantMs = Date.parse(instantIso);
  if (Number.isNaN(instantMs)) {
    throw new Error(`expected a valid ISO 8601 instant, got: ${instantIso}`);
  }
  return new Date(instantMs + TOKYO_OFFSET_MS);
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

// ---------------------------------------------------------------------
// Event genre/group classification (Issue #167, PO decision #158).
//
// - genre is a canonical lookup-table identity (public.genres), not a raw
//   UI string or a DB enum: Gate A's 3 identities (宝塚/歌舞伎/アイドル)
//   are seed *data*, not a closed schema-level vocabulary, so a future
//   genre can be added without a constraint-touching migration (#158
//   "この3genreを永久closed worldとして固定しない").
// - group is one generic canonical identity shared by 宝塚's 組 and idol
//   グループ alike (#158 "同じgeneric canonical group identity
//   mechanismで扱う") - nothing here binds a group to a genre; that
//   association only exists through which Events reference the group.
// - An Event has at most one genre (0..1) and any number of groups (0..N):
//   festival/joint Events are represented by multiple group associations,
//   never by multiple genres (#158 "future-only理由でmulti-genre
//   many-to-many machineryを先行しない").

export interface Genre {
  id: string;
  key: string;
  displayName: string;
  sortOrder: number;
}

export interface Group {
  id: string;
  key: string;
  displayName: string;
}

/** An Event's classification: at most one genre, zero or more groups.
 * Absence of a genre/any group is a valid, non-error state - see
 * EventClassificationRead.getEventClassificationsByIds. */
export interface EventClassification {
  eventId: string;
  genre: Genre | null;
  groups: Group[];
}

export interface RawGenreRow {
  id: string;
  key: string;
  display_name: string;
  sort_order: number;
}

export interface RawGroupRow {
  id: string;
  key: string;
  display_name: string;
}

export function mapGenreRow(row: RawGenreRow): Genre {
  return { id: row.id, key: row.key, displayName: row.display_name, sortOrder: row.sort_order };
}

export function mapGroupRow(row: RawGroupRow): Group {
  return { id: row.id, key: row.key, displayName: row.display_name };
}

/** Gate A's fixed display ordering (product-rules.md: 宝塚 -> 歌舞伎 ->
 * アイドル) comes from genres.sort_order, a plain integer - not string
 * comparable, so this does not reuse domain/ordering.ts's
 * compareByFieldThenId (built for string fields). id is still the
 * tie-breaker for two genres that somehow share a sort_order, so the
 * result is deterministic regardless. */
export function sortGenres(genres: readonly Genre[]): Genre[] {
  return [...genres].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -1 : 1;
  });
}

/** Deterministic group ordering for both an Event's own group list and a
 * catalog-wide group option list (Issue #167 "stable deterministic
 * ordering"): display_name first (what a user actually scans), id as the
 * tie-breaker for two groups that happen to share a display name. */
export function sortGroups(groups: readonly Group[]): Group[] {
  return [...groups].sort((a, b) => {
    if (a.displayName !== b.displayName) {
      return a.displayName < b.displayName ? -1 : 1;
    }
    if (a.id === b.id) {
      return 0;
    }
    return a.id < b.id ? -1 : 1;
  });
}

/**
 * A genre-scoped filter facet selection plus the catalog-wide universe of
 * options that facet currently has (Issue #167 "Catalog-wide filter
 * options" / "Filtering contract"). `selected` and `universeKeys`/
 * `universeVenues` name group *keys* and raw venue *text* respectively -
 * both are exact-identity comparisons (#158 "same facet内の複数selection
 * はOR" / venue "exact text match"), never fuzzy/partial matches.
 *
 * "No selection" and "every known option selected" are both defined as
 * "this facet does not filter" (#158 "none selected / all selected はその
 * facetでは絞り込まない") - isEffectiveFacetSelection below is what tells
 * matchesCatalogFilter which case it is in, so callers (#147/#145) never
 * have to special-case "select everything" themselves to get a no-op.
 */
export interface CatalogFilterSelection {
  /** Top-level genre, single-select. `null` = すべて (no genre filter). */
  genre: string | null;
  /** Selected group keys - only meaningful when the active genre's facet
   * is group (宝塚/アイドル in Gate A), but harmless to pass either way:
   * an event with no groups simply never matches a non-empty selection. */
  groups: readonly string[];
  /** Selected venue text - only meaningful when the active genre's facet
   * is venue (歌舞伎 in Gate A), same harmlessness as groups above. */
  venues: readonly string[];
}

/** The catalog-wide known-option universe for whichever genre is
 * currently selected (Issue #167 "catalog全体でknownなoptions"), used only
 * to decide the none/all no-op cases above - never to filter results
 * directly. */
export interface CatalogFilterOptionUniverse {
  groupKeys: readonly string[];
  venues: readonly string[];
}

/** True when `selected` should actually narrow results for this facet:
 * false for both "nothing selected" and "every known option selected"
 * (#158's none-or-all no-op rule). An empty `known` (no options exist yet
 * for this genre) makes any non-empty `selected` still effective - there
 * is no "select all of zero options" case to collapse to a no-op. */
function isEffectiveFacetSelection(selected: readonly string[], known: readonly string[]): boolean {
  if (selected.length === 0) {
    return false;
  }
  if (known.length === 0) {
    return true;
  }
  const knownSet = new Set(known);
  const selectedSet = new Set(selected);
  if (selectedSet.size !== knownSet.size) {
    return true;
  }
  for (const value of selectedSet) {
    if (!knownSet.has(value)) {
      return true;
    }
  }
  return false;
}

/**
 * Pure genre/group/venue filter predicate (Issue #167 "Filtering
 * contract"), reusable as-is by #147/#145 rather than each re-deriving
 * OR/AND/none/all semantics. `classification` is `null` for an
 * unclassified Event (no genre, no groups) - it never matches a specific
 * `selection.genre`, only "すべて" (#158 "unclassified Eventは...specific
 * genre filterにはhitしない"). `venue` is passed separately since it lives
 * on EventCatalogEvent, not EventClassification - venue is not a
 * classification concept, just another independent filterable dimension
 * (#158 "genre / group / venueを独立semantic dimensionとし").
 */
export function matchesCatalogFilter(
  event: {
    classification: EventClassification | null;
    venue: string | null;
  },
  selection: CatalogFilterSelection,
  universe: CatalogFilterOptionUniverse,
): boolean {
  if (selection.genre !== null) {
    if (event.classification?.genre?.key !== selection.genre) {
      return false;
    }
  }

  if (isEffectiveFacetSelection(selection.groups, universe.groupKeys)) {
    const eventGroupKeys = new Set(event.classification?.groups.map((group) => group.key) ?? []);
    if (!selection.groups.some((key) => eventGroupKeys.has(key))) {
      return false;
    }
  }

  if (isEffectiveFacetSelection(selection.venues, universe.venues)) {
    if (event.venue === null || !selection.venues.includes(event.venue)) {
      return false;
    }
  }

  return true;
}
