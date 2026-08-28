// Event-independent personal schedule domain model (Issue #33), over the
// persistence/RLS baseline Issue #31 established
// (supabase/migrations/20260822000000_create_personal_schedule.sql), and
// re-modeled from a closed schedule_type vocabulary to free-form title +
// blocking by Issue #121
// (supabase/migrations/20260826000000_personal_schedule_title_blocking.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md,
// "Event-independent personal schedule"):
// - Independent of the event catalog - not linked to any event/occurrence.
// - Exactly one of two temporal shapes, never a mix: all-day (single- or
//   multi-day, a closed [startsOn, endsOn] calendar-date range) or
//   time-bounded (startsAt required, endsAt optionally unset).
// - Every entry has a required free-form `title` (no closed category) and
//   an independent `blocking` boolean: whether this entry occupies
//   availability. `blocking` is an attribute of the entry itself, so it
//   carries the same meaning to every recipient it is shared with - there
//   is no per-recipient override.
// - Sharing is a separate concept from the entry itself: a share grants the
//   recipient read access to the *existing* entry, never mutation rights.
// - The owner may hard-delete an entry (Issue #121); deletion is not
//   soft/reversible.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

import { tokyoCalendarDayRangeUtc } from './eventCatalog.ts';
import { compareByFieldThenId, sortByFieldThenId } from './ordering.ts';

/**
 * The DB's temporal shape CHECK constraint
 * (personal_schedule_entries_temporal_shape) as a TypeScript discriminated
 * union, so "all-day" and "time-bounded" can never be represented with the
 * wrong fields present/absent on this side either.
 */
export type ScheduleTemporal =
  | { kind: 'all-day'; startsOn: string; endsOn: string }
  | { kind: 'time-bounded'; startsAt: string; endsAt: string | null };

export interface PersonalScheduleEntry {
  id: string;
  ownerId: string;
  title: string;
  blocking: boolean;
  memo: string | null;
  temporal: ScheduleTemporal;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalScheduleEntryInput {
  title: string;
  blocking: boolean;
  memo: string | null;
  temporal: ScheduleTemporal;
}

export interface ScheduleShare {
  id: string;
  scheduleEntryId: string;
  sharedWithUserId: string;
  createdAt: string;
}

/**
 * One recipient of a schedule entry's share, identified by email rather
 * than raw id - the owner-facing projection Issue #55 adds over
 * ScheduleShare so the recipient-removal UI can show and match on the same
 * exact email the owner used to add them, instead of an opaque id. Sourced
 * from public.list_schedule_share_recipient_emails, which enforces (at the
 * DB layer) that only the entry's owner can ever resolve these emails - see
 * that function's header.
 */
export interface ScheduleShareRecipient {
  shareId: string;
  recipientEmail: string;
  sharedAt: string;
}

/** The persistence row shape mapScheduleShareRecipientRow expects: the
 * columns list_schedule_share_recipient_emails returns, declared locally
 * matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawScheduleShareRecipientRow {
  share_id: string;
  recipient_email: string;
  shared_at: string;
}

export function mapScheduleShareRecipientRow(
  row: RawScheduleShareRecipientRow,
): ScheduleShareRecipient {
  return {
    shareId: row.share_id,
    recipientEmail: row.recipient_email,
    sharedAt: row.shared_at,
  };
}

/** The persistence row shape mapPersonalScheduleEntryRow expects, declared
 * locally matching the convention in domain/eventCatalog.ts's RawEventRow. */
export interface RawPersonalScheduleEntryRow {
  id: string;
  owner_id: string;
  title: string;
  blocking: boolean;
  memo: string | null;
  is_all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawScheduleShareRow {
  id: string;
  schedule_entry_id: string;
  shared_with_user_id: string;
  created_at: string;
}

function mapTemporal(row: RawPersonalScheduleEntryRow): ScheduleTemporal {
  if (row.is_all_day) {
    if (row.starts_on === null || row.ends_on === null) {
      throw new Error(`all-day personal schedule entry ${row.id} is missing starts_on/ends_on`);
    }
    return { kind: 'all-day', startsOn: row.starts_on, endsOn: row.ends_on };
  }
  if (row.starts_at === null) {
    throw new Error(`time-bounded personal schedule entry ${row.id} is missing starts_at`);
  }
  return { kind: 'time-bounded', startsAt: row.starts_at, endsAt: row.ends_at };
}

export function mapPersonalScheduleEntryRow(
  row: RawPersonalScheduleEntryRow,
): PersonalScheduleEntry {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    blocking: row.blocking,
    memo: row.memo,
    temporal: mapTemporal(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapScheduleShareRow(row: RawScheduleShareRow): ScheduleShare {
  return {
    id: row.id,
    scheduleEntryId: row.schedule_entry_id,
    sharedWithUserId: row.shared_with_user_id,
    createdAt: row.created_at,
  };
}

/**
 * Finds the caller's own share row within a list of shares, by explicit
 * positive match against their confirmed id - never by inferring "this
 * caller isn't the owner, so any share row in the list must be theirs".
 *
 * That distinction matters because listScheduleShares' result set differs
 * by who is asking: the *owner* sees every recipient's share row (the full
 * list), while a *recipient* sees only their own. A caller who picks
 * `shares[0]` whenever it believes it is not the owner would, if that
 * belief were ever wrong (e.g. an unrelated auth check failed and the
 * caller silently fell back to treating itself as "not the owner"), hand
 * back an arbitrary *other* recipient's share id - and the owner's DELETE
 * grant on any of their entry's share rows (personal_schedule_shares_
 * delete_owner_or_self) would let that id actually be removed, even though
 * the UI presented the action as the caller "leaving" a share of their
 * own. Matching by id is safe regardless of how the caller's role was
 * determined.
 */
export function findOwnScheduleShare(
  shares: readonly ScheduleShare[],
  callerId: string,
): ScheduleShare | null {
  return shares.find((share) => share.sharedWithUserId === callerId) ?? null;
}

/**
 * Converts a ScheduleTemporal into the four persistence columns it maps to.
 * The unused shape's columns are explicit nulls (not omitted), matching the
 * CHECK constraint's expectation that the *other* shape's columns are null,
 * not merely absent from the request body.
 */
export function temporalToColumns(temporal: ScheduleTemporal): {
  is_all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
} {
  if (temporal.kind === 'all-day') {
    return {
      is_all_day: true,
      starts_on: temporal.startsOn,
      ends_on: temporal.endsOn,
      starts_at: null,
      ends_at: null,
    };
  }
  return {
    is_all_day: false,
    starts_on: null,
    ends_on: null,
    starts_at: temporal.startsAt,
    ends_at: temporal.endsAt,
  };
}

/**
 * ECMA-262's own representable range for a `Date`/`Date.parse` result: a
 * timeValue is only defined for instants within ±100,000,000 days of the
 * epoch (Time Values and Time Range, ECMA-262). `Date.parse` returns `NaN`
 * for any instant string outside this range, which instantSortKey below
 * already rejects - so this is the true bound instantSortKey's numeric
 * encoding needs to cover, independent of (and, as it happens, narrower
 * than) whatever range PostgreSQL's own `timestamptz` can store.
 */
const JS_DATE_MAX_EPOCH_MS = 100_000_000 * 24 * 60 * 60 * 1000;

/**
 * Shifts any epochMs `Date.parse` can return into a non-negative range
 * (JS_DATE_MAX_EPOCH_MS is `Date`'s own max magnitude in either direction),
 * and EPOCH_MS_WIDTH is the exact digit width of the shifted range's upper
 * bound (2 * JS_DATE_MAX_EPOCH_MS) - not a hand-picked/estimated digit
 * count, which is what let two earlier revisions of this function each
 * silently stop being monotonic past a value neither had actually verified
 * against the true boundary.
 *
 * Computed as `BigInt`, not `number`: the shifted upper bound
 * (2 * JS_DATE_MAX_EPOCH_MS = 17,280,000,000,000,000) exceeds
 * `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), so ordinary `number`
 * arithmetic on values in that range silently loses precision - two
 * distinct instants near the top of the representable range collapsed to
 * the exact same floating-point sum in an earlier revision of this
 * function, which is exactly the kind of drift this sort key exists to
 * prevent. `BigInt` addition and `.toString()` are exact at any magnitude.
 *
 * Exported (not just used internally) so Home's upcoming-projection helper
 * (domain/homeUpcoming.ts, Issue #143) can build one chronological sort key
 * across both an Occurrence's raw `startsAt` and a PersonalScheduleEntry's
 * own start (via entryStart below) without re-deriving this same
 * format/precision normalization a second time.
 */
const EPOCH_MS_OFFSET = BigInt(JS_DATE_MAX_EPOCH_MS);
const EPOCH_MS_WIDTH = (EPOCH_MS_OFFSET * BigInt(2)).toString().length;

/**
 * A sort key guaranteed to compare greater than every key
 * instantSortKey's normal path can produce (which are always exactly
 * `EPOCH_MS_WIDTH + 3` characters of decimal digits): one digit longer,
 * and every digit '9'. Any string that shares this one's first
 * `EPOCH_MS_WIDTH + 3` characters is by definition a prefix of it, and a
 * strict prefix always compares less in a plain codepoint-by-codepoint
 * string comparison - so this sorts after every normally-computed key
 * regardless of that key's own digits.
 */
const UNORDERABLE_INSTANT_SORT_KEY = '9'.repeat(EPOCH_MS_WIDTH + 3 + 1);

/**
 * Normalizes an ISO 8601 UTC instant string to a sort key that string-
 * compares in true chronological order, at full microsecond precision -
 * the precision PostgreSQL's `timestamptz` itself carries - across every
 * instant `Date.parse` can represent at all (see JS_DATE_MAX_EPOCH_MS
 * above).
 *
 * `Date.parse`/`Date#getTime()` round to millisecond resolution, so two
 * instants less than 1ms apart collapse to the same epoch-millisecond
 * value and would otherwise fall through to the `id` tie-breaker instead
 * of true chronological order. The fractional-second digits beyond the
 * third (the sub-millisecond, i.e. microsecond, part) are therefore read
 * directly from the source string - never from a parsed `Date` - and
 * appended after a fixed-width, zero-padded, offset epoch so that plain
 * string comparison of the combined key matches chronological order
 * exactly: equal down to the millisecond compares by the next three
 * (sub-millisecond) digits, and unequal milliseconds always dominate
 * because the shifted-epoch-millisecond prefix is fixed-width and always
 * non-negative (the offset absorbs pre-1970 instants, which would
 * otherwise sort backwards through the leading "-" sign as an ordinary
 * string character).
 *
 * PostgreSQL's own `timestamptz` range (4713 BC - 294276 AD) is wider than
 * what `Date.parse` can represent at all, and this column carries no CHECK
 * constraint bounding it to a narrower range (Issue #31; adding one is out
 * of this Task's scope). A row holding such a value cannot be placed in
 * true chronological order by this function - doing so would need a
 * hand-written parser for PostgREST's own timestamp serialization independent
 * of `Date`, which is disproportionate to a range no realistic use of this
 * product's Asia/Tokyo-scoped personal-schedule feature would ever produce.
 * What this function must still do is not crash the read path over it: an
 * unparseable instant sorts last via a reserved sentinel key, deterministic
 * and stable, rather than throwing past listVisiblePersonalSchedule's
 * PlanningResult boundary.
 */
export function instantSortKey(instantIso: string): string {
  const epochMs = Date.parse(instantIso);
  if (Number.isNaN(epochMs)) {
    return UNORDERABLE_INSTANT_SORT_KEY;
  }
  const paddedEpochMs = (BigInt(epochMs) + EPOCH_MS_OFFSET)
    .toString()
    .padStart(EPOCH_MS_WIDTH, '0');
  const fractionMatch = /\.(\d+)/.exec(instantIso);
  const fractionDigits = (fractionMatch?.[1] ?? '').padEnd(6, '0');
  const subMillisecondDigits = fractionDigits.slice(3, 6);
  return `${paddedEpochMs}${subMillisecondDigits}`;
}

/**
 * Deterministic ordering for a personal schedule listing: all-day entries
 * order by startsOn, time-bounded entries by startsAt - both are the
 * "when does this entry begin" field for their shape - with id as a stable
 * tie-breaker (see domain/ordering.ts).
 *
 * Both sides go through instantSortKey, not a direct string or `Date.parse`
 * comparison. An all-day entry's startsOn ("YYYY-MM-DD") is first converted
 * to the UTC instant its Asia/Tokyo calendar day begins at - comparing it
 * as a bare date string against a full ISO timestamp directly is not
 * equivalent to chronological order whenever they fall close together:
 * Tokyo's UTC+9 offset means a UTC timestamp from 15:00 onward already
 * belongs to the *next* Tokyo calendar day, so e.g. all-day "2026-01-01"
 * (Tokyo midnight = instant 2025-12-31T15:00:00Z) would sort after the
 * time-bounded instant "2025-12-31T16:00:00Z" as bare strings ("2026-..." >
 * "2025-...") even though 15:00Z is earlier than 16:00Z. Beyond that, even
 * after converting startsOn to an ISO instant, comparing it directly
 * against startsAt is still not safe: startsAt is whatever format
 * PostgREST happens to return a persisted timestamptz in (typically
 * "+00:00", not "Z", and a variable number of fractional-second digits),
 * which does not sort identically to a client-computed `.toISOString()`
 * string even for nearby instants - and a plain millisecond-resolution
 * `Date.parse` comparison loses PostgreSQL's microsecond precision,
 * collapsing sub-millisecond-apart instants into ties. instantSortKey
 * normalizes both formatting differences and precision loss at once.
 */
/**
 * Exported so Home's upcoming-projection helper (domain/homeUpcoming.ts,
 * Issue #143) can compute the same normalized sort key for a
 * PersonalScheduleEntry directly, to place it in one unified chronological
 * order alongside participation-registered Occurrences.
 */
export function entryStart(entry: PersonalScheduleEntry): string {
  return entry.temporal.kind === 'all-day'
    ? instantSortKey(tokyoCalendarDayRangeUtc(entry.temporal.startsOn).startUtc)
    : instantSortKey(entry.temporal.startsAt);
}

export function comparePersonalScheduleEntriesByStart(
  a: PersonalScheduleEntry,
  b: PersonalScheduleEntry,
): number {
  return compareByFieldThenId(a, b, entryStart);
}

export function sortPersonalScheduleEntries(
  entries: readonly PersonalScheduleEntry[],
): PersonalScheduleEntry[] {
  return sortByFieldThenId(entries, entryStart);
}
