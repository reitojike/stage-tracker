// Pure URL/param handling for the Catalog feature (Issue #20)'s
// "month calendar -> selected-day list -> event detail" navigation
// (docs/ux-ui.md primary interaction pattern). Kept free of Next.js types
// so it is plain, DB-free, unit-testable logic like the rest of src/domain.
//
// Validity of a "YYYY-MM"/"YYYY-MM-DD" value is delegated to
// calendarMonth.ts's isValidYearMonth/isValidCalendarDate (which reuse
// eventCatalog.ts's Date.UTC round-trip check) rather than a shape-only
// regex here: a value like "2026-13" or "2026-02-30" is digit-shape-valid
// but not a real calendar month/date, and treating it as valid would let a
// malformed query param silently drive the grid to a rolled-over month
// instead of being ignored like any other malformed value.

import { isValidCalendarDate, isValidYearMonth } from './calendarMonth.ts';
import { tokyoCalendarDateFromInstant } from './eventCatalog.ts';

export interface CatalogParams {
  yearMonth: string;
  /** null when no day is selected yet (bare month-calendar view). */
  selectedDate: string | null;
}

/**
 * Resolves the effective month/selected-day from raw (and possibly
 * missing/malformed) query params, given the caller's notion of "today"
 * (Asia/Tokyo calendar date) as the default. A valid `date` always wins for
 * deriving the displayed month - a `month` param that disagreed with it
 * would otherwise let the grid and the selected day silently drift apart.
 * Malformed values are ignored rather than surfaced as an error: this is
 * client-supplied navigation state, not domain data.
 */
export function resolveCatalogParams(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  todayTokyoDate: string,
): CatalogParams {
  const rawDate = firstValue(searchParams.date);
  const selectedDate = rawDate !== undefined && isValidCalendarDate(rawDate) ? rawDate : null;

  const rawMonth = firstValue(searchParams.month);
  const monthFromDate = selectedDate?.slice(0, 7) ?? null;
  const monthFromParam = rawMonth !== undefined && isValidYearMonth(rawMonth) ? rawMonth : null;
  const yearMonth = monthFromDate ?? monthFromParam ?? todayTokyoDate.slice(0, 7);

  return { yearMonth, selectedDate };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function previousYearMonth(yearMonth: string): string {
  return shiftYearMonth(yearMonth, -1);
}

export function nextYearMonth(yearMonth: string): string {
  return shiftYearMonth(yearMonth, 1);
}

function shiftYearMonth(yearMonth: string, delta: number): string {
  if (!isValidYearMonth(yearMonth)) {
    throw new Error(`expected a valid "YYYY-MM" month, got: ${yearMonth}`);
  }
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Absolute zero-based month index (from year 0), so both the year carry
  // and the month wraparound fall out of one division/modulo instead of
  // needing separate under/overflow branches.
  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth + 1).padStart(2, '0')}`;
}

export function catalogMonthHref(yearMonth: string): string {
  return `/catalog?month=${yearMonth}`;
}

export function catalogDayHref(yearMonth: string, date: string): string {
  return `/catalog?month=${yearMonth}&date=${date}`;
}

/**
 * `occurrenceId` carries the exact occurrence a selected-day row was chosen
 * for (Issue #107) - omitted for the generic "open this event" journey
 * (e.g. from an event title), which has no single occurrence in mind. The
 * destination page independently re-validates the `occurrence` query param
 * against the event's actual occurrences (see resolveFocusedOccurrenceId)
 * rather than trusting it, so a caller does not need to.
 *
 * The same id also drives the URL's hash fragment (`#occurrence-<id>`) so
 * the App Router's own navigation handling scrolls/focuses that list item
 * into view on arrival - see occurrenceAnchorId and EventDetail, which
 * gives the matching list item that exact id. This reuses a built-in
 * mechanism rather than adding bespoke client-side scroll/focus logic that
 * would have to race it.
 */
export function catalogEventHref(
  eventId: string,
  context: CatalogParams,
  occurrenceId?: string | null,
): string {
  const params = baseContextSearchParams(context);
  if (occurrenceId === undefined || occurrenceId === null) {
    return `/catalog/events/${eventId}?${params.toString()}`;
  }
  params.set('occurrence', occurrenceId);
  return `/catalog/events/${eventId}?${params.toString()}#${occurrenceAnchorId(occurrenceId)}`;
}

/**
 * The Event-detail deep-link href for a screen that has no ambient month/day
 * navigation state of its own to carry as context (Issue #194) - Home's
 * upcoming rows and deadline cards both derive one directly from whichever
 * Occurrence they are about, rather than each re-deriving the same
 * `tokyoCalendarDateFromInstant(startsAt) -> { yearMonth, selectedDate }`
 * shape independently.
 */
export function occurrenceEventDetailHref(
  eventId: string,
  occurrenceId: string,
  occurrenceStartsAt: string,
): string {
  const date = tokyoCalendarDateFromInstant(occurrenceStartsAt);
  return catalogEventHref(
    eventId,
    { yearMonth: date.slice(0, 7), selectedDate: date },
    occurrenceId,
  );
}

/**
 * The write screens (Issue #29) carry the same month/day context as the
 * read screens, so returning from them lands on the calendar the user came
 * from rather than on today's month.
 */
export function catalogNewEventHref(context: CatalogParams): string {
  return `/catalog/events/new?${contextParams(context)}`;
}

export function catalogEditEventHref(eventId: string, context: CatalogParams): string {
  return `/catalog/events/${eventId}/edit?${contextParams(context)}`;
}

/** The viewer's own received-invitations list (Issue #36). Carries no
 * month/day context: unlike the calendar-rooted screens above, this is not
 * reached by navigating a particular month, and returning from it has
 * nowhere calendar-specific to go back to. */
export function catalogInvitationsHref(): string {
  return '/catalog/invitations';
}

function contextParams(context: CatalogParams): string {
  return baseContextSearchParams(context).toString();
}

function baseContextSearchParams(context: CatalogParams): URLSearchParams {
  const params = new URLSearchParams({ month: context.yearMonth });
  if (context.selectedDate !== null) {
    params.set('date', context.selectedDate);
  }
  return params;
}

/**
 * Re-validates a raw `occurrence` query param against the occurrences that
 * actually belong to the event being viewed, returning null for anything
 * that does not exactly match (missing, malformed, foreign-event, or
 * stale/deleted) - the same "ignore, don't error" treatment
 * resolveCatalogParams gives malformed month/date params, since this is
 * also client-supplied navigation state, not domain data. A null result
 * means "no exact occurrence in focus", which the caller falls back to the
 * generic event-level presentation for (Issue #107): this never resolves
 * to the wrong occurrence, only to "none".
 */
export function resolveFocusedOccurrenceId(
  rawOccurrenceParam: string | string[] | undefined,
  occurrenceIds: readonly string[],
): string | null {
  const raw = firstValue(rawOccurrenceParam);
  return raw !== undefined && occurrenceIds.includes(raw) ? raw : null;
}

/** The DOM anchor id an occurrence's list item is identified by, shared by
 * the element itself and whatever scrolls/focuses it into view - kept out
 * of the raw occurrence id (a UUID, which may start with a digit and is
 * not a safe bare CSS/DOM id) by a stable prefix. */
export function occurrenceAnchorId(occurrenceId: string): string {
  return `occurrence-${occurrenceId}`;
}
