// Home "直近の予定" (upcoming) block projection (Issue #143).
//
// Merges two already-fetched personal planning slices - participation-
// registered occurrences and event-independent personal schedule (own +
// shared) - into one bounded, nearest-first list, the same "compose what the
// typed reads already returned, add no new visibility judgment of its own"
// discipline domain/myCalendar.ts follows for My Calendar. This module never
// reads legacy ticket_acquisitions - Home's Task Contract explicitly keeps
// that model out of this projection.
//
// Deterministic by construction: every function here takes `nowInstant`/
// `todayTokyoDate` as explicit parameters rather than reading the clock
// itself, so tests can inject a fixed instant (see src/app/(home)/_lib/now.ts
// for the route's own clock read).
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { entryStart, instantSortKey, type PersonalScheduleEntry } from './personalSchedule.ts';
import {
  tokyoCalendarDateFromInstant,
  type EventCatalogEvent,
  type EventOccurrence,
} from './eventCatalog.ts';
import type { Participation } from './participation.ts';
import { HOME_UPCOMING_LIMIT, HOME_WINDOW_DAYS, isOnOrBeforeDaysAhead } from './visibleWindow.ts';

export { HOME_UPCOMING_LIMIT, HOME_WINDOW_DAYS };

export interface HomeUpcomingOccurrenceCandidate {
  event: EventCatalogEvent;
  occurrence: EventOccurrence;
  participation: Participation;
}

export interface HomeUpcomingScheduleCandidate {
  entry: PersonalScheduleEntry;
  /** True when the caller owns this entry; false when it was shared with
   * them - same signal domain/myCalendar.ts's MyCalendarScheduleEntry
   * carries, for the same "自分の予定"/"共有されている予定" label. */
  isOwner: boolean;
}

export interface HomeUpcomingOccurrenceItem extends HomeUpcomingOccurrenceCandidate {
  kind: 'occurrence';
}

export interface HomeUpcomingScheduleItem extends HomeUpcomingScheduleCandidate {
  kind: 'schedule';
}

export type HomeUpcomingItem = HomeUpcomingOccurrenceItem | HomeUpcomingScheduleItem;

function isAtOrAfter(candidateInstantIso: string, referenceInstantIso: string): boolean {
  // A coarse millisecond-resolution "is this still current/future" gate,
  // not a stable sort key - unlike instantSortKey/entryStart below, this
  // never needs to distinguish two instants sub-millisecond apart, so a
  // plain Date.parse comparison is safe here even though nowInstant (a
  // client-computed .toISOString()) and occurrence/entry instants (raw
  // PostgREST timestamptz strings) can differ in offset notation/fractional
  // digit count - Date.parse normalizes both before comparing.
  return Date.parse(candidateInstantIso) >= Date.parse(referenceInstantIso);
}

/** Issue #143 Task Contract minimum candidacy rule for a participation-
 * registered occurrence: `startsAt` at or after "now" - an occurrence
 * already in progress does not qualify (deliberately narrower than the
 * "currently active" allowance personal schedule gets below; the Task
 * Contract states this rule for occurrences with no such allowance). */
function isOccurrenceCandidate(occurrence: EventOccurrence, nowInstant: string): boolean {
  return isAtOrAfter(occurrence.startsAt, nowInstant);
}

/**
 * Issue #143 Task Contract candidacy rules for a personal schedule entry,
 * one branch per ScheduleTemporal shape:
 * - all-day: a candidate whenever its span hasn't fully ended yet
 *   (`endsOn >= today`), including one already in progress today - this is
 *   exactly what lets a currently-active multi-day entry surface ahead of
 *   pure-future items once sorted by start (see compareHomeUpcomingItems).
 * - time-bounded with a known end: a candidate while that end is still at
 *   or after "now".
 * - time-bounded with no end: never implicitly extended forever (the same
 *   "never assume it never ends" rule domain/myCalendar.ts's
 *   scheduleEntryDatesInRange documents) - a candidate only while its own
 *   start date hasn't already passed.
 */
function isScheduleCandidate(
  entry: PersonalScheduleEntry,
  nowInstant: string,
  todayTokyoDate: string,
): boolean {
  if (entry.temporal.kind === 'all-day') {
    return entry.temporal.endsOn >= todayTokyoDate;
  }
  if (entry.temporal.endsAt !== null) {
    return isAtOrAfter(entry.temporal.endsAt, nowInstant);
  }
  return tokyoCalendarDateFromInstant(entry.temporal.startsAt) >= todayTokyoDate;
}

function homeUpcomingItemId(item: HomeUpcomingItem): string {
  return item.kind === 'occurrence' ? item.occurrence.id : item.entry.id;
}

/**
 * One chronological sort key per item, comparable across both kinds -
 * instantSortKey/entryStart (personalSchedule.ts) already normalize the
 * format/precision differences between a raw Occurrence `startsAt` and a
 * PersonalScheduleEntry's own start (including converting an all-day
 * entry's calendar date to its Tokyo-midnight instant), so this never
 * re-derives that normalization. A currently-active all-day/multi-day
 * schedule entry naturally sorts ahead of a pure-future item here, since its
 * own start is earlier - no separate "ongoing items first" rule is needed
 * (Issue #143 Task Contract: "現在進行中のmulti-day/all-day scheduleは
 * future itemより前に自然に見える").
 */
function homeUpcomingItemSortKey(item: HomeUpcomingItem): string {
  return item.kind === 'occurrence'
    ? instantSortKey(item.occurrence.startsAt)
    : entryStart(item.entry);
}

function compareHomeUpcomingItems(a: HomeUpcomingItem, b: HomeUpcomingItem): number {
  const keyA = homeUpcomingItemSortKey(a);
  const keyB = homeUpcomingItemSortKey(b);
  if (keyA !== keyB) {
    return keyA < keyB ? -1 : 1;
  }
  const idA = homeUpcomingItemId(a);
  const idB = homeUpcomingItemId(b);
  if (idA === idB) {
    return 0;
  }
  return idA < idB ? -1 : 1;
}

/**
 * Selects and orders Home's "直近の予定" items (Issue #192 bounded
 * supersede of Issue #143's max-8/no-window projection): every current/
 * future candidate from both sources (see isOccurrenceCandidate/
 * isScheduleCandidate) is merged into one nearest-first list, then narrowed
 * to HOME_WINDOW_DAYS (today..+14 Asia/Tokyo calendar days, inclusive) and
 * capped at HOME_UPCOMING_LIMIT.
 *
 * When zero candidates fall inside that window, the single nearest
 * candidate outside it is returned instead (Task Contract: "14日以内に1件も
 * 無いときは、次の1件だけを日付付きで出す") - never an empty section as long
 * as at least one current/future candidate exists at all. This fallback
 * only ever contributes when the windowed list is empty: any candidate
 * inside the window means no outside-window item is added.
 *
 * `occurrenceCandidates` and `scheduleCandidates` are expected to already be
 * whatever the caller's own typed reads (listMyParticipations +
 * listVisiblePersonalSchedule, composed with the Event Catalog read
 * boundary) returned - this function performs no additional visibility
 * filtering that could substitute for RLS, only the temporal
 * candidacy/window/ordering/cap Home's Task Contract specifies.
 */
export function selectHomeUpcomingItems(
  occurrenceCandidates: readonly HomeUpcomingOccurrenceCandidate[],
  scheduleCandidates: readonly HomeUpcomingScheduleCandidate[],
  nowInstant: string,
  todayTokyoDate: string,
): HomeUpcomingItem[] {
  const occurrenceItems: HomeUpcomingItem[] = occurrenceCandidates
    .filter((candidate) => isOccurrenceCandidate(candidate.occurrence, nowInstant))
    .map((candidate) => ({ kind: 'occurrence', ...candidate }));

  const scheduleItems: HomeUpcomingItem[] = scheduleCandidates
    .filter((candidate) => isScheduleCandidate(candidate.entry, nowInstant, todayTokyoDate))
    .map((candidate) => ({ kind: 'schedule', ...candidate }));

  const sorted = [...occurrenceItems, ...scheduleItems].sort(compareHomeUpcomingItems);

  const withinWindow = sorted.filter((item) =>
    isOnOrBeforeDaysAhead(homeUpcomingItemTokyoDate(item), todayTokyoDate, HOME_WINDOW_DAYS),
  );

  if (withinWindow.length > 0) {
    return withinWindow.slice(0, HOME_UPCOMING_LIMIT);
  }
  return sorted.slice(0, 1);
}

export interface HomeUpcomingDateGroup {
  /** Asia/Tokyo calendar date ("YYYY-MM-DD") every item in `items` groups
   * under - an occurrence's own start date, or a schedule entry's own start
   * date (all-day: startsOn directly; time-bounded: its startsAt's Tokyo
   * calendar date). */
  date: string;
  items: HomeUpcomingItem[];
}

function homeUpcomingItemTokyoDate(item: HomeUpcomingItem): string {
  if (item.kind === 'occurrence') {
    return tokyoCalendarDateFromInstant(item.occurrence.startsAt);
  }
  return item.entry.temporal.kind === 'all-day'
    ? item.entry.temporal.startsOn
    : tokyoCalendarDateFromInstant(item.entry.temporal.startsAt);
}

/**
 * Groups an already nearest-first-sorted item list into contiguous
 * same-date buckets, preserving order - the same contiguous-grouping shape
 * groupTicketOpportunityTimelineRowsByMonth uses for month buckets. Expects
 * `items` to already be selectHomeUpcomingItems's own output (or an
 * equivalently sorted list); it does not re-sort.
 */
export function groupHomeUpcomingItemsByDate(
  items: readonly HomeUpcomingItem[],
): HomeUpcomingDateGroup[] {
  const groups: HomeUpcomingDateGroup[] = [];
  for (const item of items) {
    const date = homeUpcomingItemTokyoDate(item);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup !== undefined && lastGroup.date === date) {
      lastGroup.items.push(item);
    } else {
      groups.push({ date, items: [item] });
    }
  }
  return groups;
}
