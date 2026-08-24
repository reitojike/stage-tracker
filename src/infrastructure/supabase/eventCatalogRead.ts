import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.ts';
import {
  attachOccurrencesToEvents,
  groupOccurrencesByEvent,
  mapEventRow,
  mapOccurrenceRow,
  mapPostgrestError,
  sortOccurrences,
  tokyoCalendarDateFromInstant,
  tokyoCalendarDayRangeUtc,
  type EventCatalogEvent,
  type EventCatalogReadResult,
  type EventOccurrence,
  type EventWithOccurrences,
  type RawPostgrestError,
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
 * PostgREST caps any single response at supabase/config.toml's
 * `api.max_rows` (currently 1000), silently - a request for more rows than
 * that just comes back short, with no error and no indication truncation
 * happened. A collection read that does a single unranged `.select()` is
 * therefore only ever correct by accident, for tables that happen to stay
 * under the cap. fetchAllRows below paginates with `.range()` and keeps
 * requesting pages until the accumulated row count reaches the *reported*
 * total (from `count: 'exact'`), rather than assuming "a page shorter than
 * what we asked for means we're done" - that assumption breaks if
 * max_rows is ever configured below our own page size, silently
 * reintroducing the same truncation this exists to prevent. PAGE_SIZE
 * itself does not need to match max_rows exactly for correctness, only for
 * request-count efficiency.
 */
const PAGE_SIZE = 500;

/**
 * `.in('id', eventIds)` embeds the id list directly in the request URL;
 * an unbounded list both risks exceeding practical URL/query length limits
 * and produces a response whose row count is only as safe as PAGE_SIZE
 * above. Chunking keeps each request's id list bounded independently of
 * how many distinct events a range/day query happens to touch.
 */
const ID_BATCH_SIZE = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

interface PageResponse<Row> {
  data: Row[] | null;
  error: RawPostgrestError | null;
  count: number | null;
}

/**
 * Drives an arbitrary `.range(from, to)`-based PostgREST query to
 * completion, accumulating every row regardless of how many pages that
 * takes. `queryPage` must request `{ count: 'exact' }` so a reported total
 * is available - without one, this has no reliable way to distinguish "the
 * last page happened to be short" from "max_rows silently capped this
 * page below what was asked for", so it fails closed (an error result)
 * rather than ever returning a possibly-incomplete page set as success.
 */
async function fetchAllRows<Row>(
  queryPage: (from: number, to: number) => PromiseLike<PageResponse<Row>>,
): Promise<EventCatalogReadResult<Row[]>> {
  const rows: Row[] = [];
  let offset = 0;
  for (;;) {
    const { data, error, count } = await queryPage(offset, offset + PAGE_SIZE - 1);
    if (error !== null) {
      return { ok: false, error: mapPostgrestError(error) };
    }
    if (count === null) {
      return {
        ok: false,
        error: {
          message: 'Postgrest did not report a total row count for a paginated query',
          code: 'pagination-count-missing',
        },
      };
    }
    if (data === null) {
      return {
        ok: false,
        error: {
          message: 'Postgrest returned no data and no error for a paginated query',
          code: 'pagination-data-missing',
        },
      };
    }
    rows.push(...data);
    offset += data.length;
    if (data.length === 0 || offset >= count) {
      break;
    }
  }
  return { ok: true, data: rows };
}

/**
 * Fetches events by id in ID_BATCH_SIZE-sized batches (bounding both the
 * `.in()` list length and, independently, each batch's own response via
 * fetchAllRows), preserving no particular event ordering - callers that
 * care about output order (groupOccurrencesByEvent) derive it from the
 * occurrences, not from this fetch order.
 */
async function fetchEventsByIds(
  client: EventCatalogQueryClient,
  eventIds: readonly string[],
): Promise<EventCatalogReadResult<EventCatalogEvent[]>> {
  const events: EventCatalogEvent[] = [];
  for (const idBatch of chunk(eventIds, ID_BATCH_SIZE)) {
    const batchResult = await fetchAllRows((from, to) =>
      client
        .from('events')
        .select('*', { count: 'exact' })
        .in('id', idBatch)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (!batchResult.ok) {
      return batchResult;
    }
    events.push(...batchResult.data.map(mapEventRow));
  }
  return { ok: true, data: events };
}

/**
 * Events by id, in ID_BATCH_SIZE-sized batches - the exported form of
 * fetchEventsByIds above, for callers outside this module that already have
 * a set of event ids from elsewhere (Issue #36: the received-invitations
 * screen resolves occurrence -> event this way, since an invitation only
 * carries an occurrence id).
 */
export async function getEventsByIds(
  client: EventCatalogQueryClient,
  eventIds: readonly string[],
): Promise<EventCatalogReadResult<EventCatalogEvent[]>> {
  return fetchEventsByIds(client, eventIds);
}

/**
 * Occurrences by id, in ID_BATCH_SIZE-sized batches (Issue #36: same need as
 * getEventsByIds above, but for occurrences - an invitation names an
 * occurrence id directly). Preserves no particular ordering; callers that
 * care derive their own order the way listEventCatalog's callers derive
 * theirs.
 */
export async function getOccurrencesByIds(
  client: EventCatalogQueryClient,
  occurrenceIds: readonly string[],
): Promise<EventCatalogReadResult<EventOccurrence[]>> {
  const occurrences: EventOccurrence[] = [];
  for (const idBatch of chunk(occurrenceIds, ID_BATCH_SIZE)) {
    const batchResult = await fetchAllRows((from, to) =>
      client
        .from('event_occurrences')
        .select('*', { count: 'exact' })
        .in('id', idBatch)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (!batchResult.ok) {
      return batchResult;
    }
    occurrences.push(...batchResult.data.map(mapOccurrenceRow));
  }
  return { ok: true, data: occurrences };
}

/**
 * The whole shared catalog: every event with its occurrences, events
 * ordered by created_at (registration order) as the minimal deterministic
 * default, occurrences within each event ordered per
 * domain/eventCatalog.ts's compareOccurrencesByStartsAt. Both the event set
 * and the occurrence set are fetched to completion via fetchAllRows, so
 * neither silently truncates at api.max_rows.
 */
export async function listEventCatalog(
  client: EventCatalogQueryClient,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  const eventsResult = await fetchAllRows((from, to) =>
    client
      .from('events')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!eventsResult.ok) {
    return eventsResult;
  }

  const occurrencesResult = await fetchAllRows((from, to) =>
    client
      .from('event_occurrences')
      .select('*', { count: 'exact' })
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!occurrencesResult.ok) {
    return occurrencesResult;
  }

  const events = eventsResult.data.map(mapEventRow);
  const occurrences = occurrencesResult.data.map(mapOccurrenceRow);
  return { ok: true, data: attachOccurrencesToEvents(events, occurrences) };
}

/**
 * Events whose Event range (starts_on/ends_on) overlaps the given
 * half-open instant range, regardless of whether they have any occurrence
 * at all - this is what makes a 0-occurrence event (Issue #87/#88) visible
 * in a period-scoped read, independent of the occurrence-based query in
 * listEventCatalogInRange below (product-rules.md "Catalog の日程参照要件":
 * "指定した期間と Event range が重なる event は、公演回の有無にかかわらず
 * 引けます"). The instant range's end bound is exclusive, so it is
 * converted to an inclusive Tokyo calendar date one instant earlier before
 * comparing against the date-typed starts_on/ends_on columns.
 */
async function fetchEventsByRangeOverlap(
  client: EventCatalogQueryClient,
  range: UtcInstantRange,
): Promise<EventCatalogReadResult<EventCatalogEvent[]>> {
  const startDate = tokyoCalendarDateFromInstant(range.startUtc);
  const endDateInclusive = tokyoCalendarDateFromInstant(
    new Date(Date.parse(range.endUtcExclusive) - 1).toISOString(),
  );
  const result = await fetchAllRows((from, to) =>
    client
      .from('events')
      .select('*', { count: 'exact' })
      .lte('starts_on', endDateInclusive)
      .gte('ends_on', startDate)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: result.data.map(mapEventRow) };
}

/**
 * Events with at least one occurrence in the half-open instant range
 * `[range.startUtc, range.endUtcExclusive)`, unioned with every event whose
 * Event range overlaps the same period even if it currently has zero
 * occurrences (see fetchEventsByRangeOverlap above) - the two queries are
 * independent product read requirements, not one derived from the other,
 * so neither's failure is folded into a silent empty result for the other.
 *
 * Only the occurrences that actually fall in range are included on an
 * occurrence-bearing event (an event's occurrences outside the range are
 * not attached); a range-overlap-only event is included with an empty
 * occurrences array rather than being absent. Deduplicated by event id
 * (an event can satisfy both queries at once) - the occurrence-bearing
 * entry wins when both are present, since it carries real occurrence data
 * the range-only entry does not.
 *
 * Result ordering: occurrence-bearing events first, by soonest in-range
 * occurrence (unchanged from before Issue #88); range-overlap-only events
 * follow, ordered by starts_on then id for a stable, deterministic tail.
 *
 * The in-range occurrence set is fetched to completion via fetchAllRows (so
 * an event whose only in-range occurrence falls past api.max_rows worth of
 * earlier occurrences is never dropped), and the resulting event ids are
 * looked up in ID_BATCH_SIZE-sized batches rather than one unbounded
 * `.in()` call.
 */
export async function listEventCatalogInRange(
  client: EventCatalogQueryClient,
  range: UtcInstantRange,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  // Independent queries (see doc comment above) - run concurrently rather
  // than sequentially, since neither depends on the other's result. Each
  // failure is still checked and returned on its own: a rejection is never
  // folded into an empty result for the other query, and a success is
  // never assumed just because Promise.all resolved.
  const [occurrencesResult, rangeOverlapResult] = await Promise.all([
    fetchAllRows((from, to) =>
      client
        .from('event_occurrences')
        .select('*', { count: 'exact' })
        .gte('starts_at', range.startUtc)
        .lt('starts_at', range.endUtcExclusive)
        .order('starts_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchEventsByRangeOverlap(client, range),
  ]);
  if (!occurrencesResult.ok) {
    return occurrencesResult;
  }
  if (!rangeOverlapResult.ok) {
    return rangeOverlapResult;
  }

  const occurrences = occurrencesResult.data.map(mapOccurrenceRow);
  let occurrenceGroups: EventWithOccurrences[] = [];
  if (occurrences.length > 0) {
    const eventIds = [...new Set(occurrences.map((occurrence) => occurrence.eventId))];
    const eventsResult = await fetchEventsByIds(client, eventIds);
    if (!eventsResult.ok) {
      return eventsResult;
    }
    occurrenceGroups = groupOccurrencesByEvent(eventsResult.data, occurrences);
  }

  const seenEventIds = new Set(occurrenceGroups.map((group) => group.event.id));
  const rangeOnlyGroups = rangeOverlapResult.data
    .filter((event) => !seenEventIds.has(event.id))
    .sort((a, b) =>
      a.startsOn === b.startsOn ? a.id.localeCompare(b.id) : a.startsOn < b.startsOn ? -1 : 1,
    )
    .map((event) => ({ event, occurrences: [] }));

  return { ok: true, data: [...occurrenceGroups, ...rangeOnlyGroups] };
}

/**
 * Events with an occurrence on the given Asia/Tokyo calendar day
 * ("YYYY-MM-DD"), and that day's occurrence times - a thin convenience
 * wrapper over listEventCatalogInRange using the Tokyo day boundary.
 *
 * Deliberately narrower than listEventCatalogInRange's own contract: that
 * function also surfaces range-overlap-only events (Issue #88, "指定した
 * 期間と Event range が重なる event は、公演回の有無にかかわらず引けます"),
 * which is a period-scoped read requirement, not a day-scoped one - "ある
 * 日を指定して、その日に公演回がある event" (product-rules.md 「Catalog の
 * 日程参照要件」) is this function's own, independent contract, so a
 * range-only event with no occurrence on `tokyoDate` itself is filtered
 * back out here rather than inherited from the wrapped call.
 */
export async function listEventCatalogOnDate(
  client: EventCatalogQueryClient,
  tokyoDate: string,
): Promise<EventCatalogReadResult<EventWithOccurrences[]>> {
  const result = await listEventCatalogInRange(client, tokyoCalendarDayRangeUtc(tokyoDate));
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: result.data.filter((group) => group.occurrences.length > 0) };
}

/**
 * A single event's occurrences, ordered deterministically by starts_at.
 * Fetched to completion via fetchAllRows, so an event with more
 * occurrences than api.max_rows never has its later ones silently
 * dropped.
 */
export async function listEventOccurrences(
  client: EventCatalogQueryClient,
  eventId: string,
): Promise<EventCatalogReadResult<EventOccurrence[]>> {
  const result = await fetchAllRows((from, to) =>
    client
      .from('event_occurrences')
      .select('*', { count: 'exact' })
      .eq('event_id', eventId)
      .order('starts_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (!result.ok) {
    return result;
  }
  return { ok: true, data: sortOccurrences(result.data.map(mapOccurrenceRow)) };
}

/**
 * A single event and its occurrences. `data: null` (not an error) means no
 * event exists with that id. The event lookup itself is a single-row
 * `maybeSingle()` (never subject to the multi-row max_rows cap); its
 * occurrences go through listEventOccurrences above, which is.
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

/**
 * An event's Event range alone, without its occurrences or descriptive
 * fields - for write paths that need to validate a submitted occurrence
 * against its parent's range (Issue #88's containment invariant, checked
 * application-side ahead of the DB round trip via
 * domain/eventCatalogWrite.ts's validateOccurrenceWithinRange) without
 * paying for a full getEventWithOccurrences read.
 */
export async function getEventRange(
  client: EventCatalogQueryClient,
  eventId: string,
): Promise<EventCatalogReadResult<{ startsOn: string; endsOn: string } | null>> {
  const { data, error } = await client
    .from('events')
    .select('starts_on, ends_on')
    .eq('id', eventId)
    .maybeSingle();
  if (error !== null) {
    return { ok: false, error: mapPostgrestError(error) };
  }
  if (data === null) {
    return { ok: true, data: null };
  }
  return { ok: true, data: { startsOn: data.starts_on, endsOn: data.ends_on } };
}
