import {
  parseTokyoCalendarDate,
  tokyoCalendarDateFromInstant,
  tokyoLocalInstant,
} from './eventCatalog.ts';

// Pure Asia/Tokyo display formatting for the Catalog feature (Issue #20).
// Uses the same fixed +9h offset as the rest of this domain (never the JS
// runtime's local timezone), via eventCatalog.ts's tokyoLocalInstant, to
// turn a UTC instant into Tokyo local hour/minute/date fields for display.

/** "HH:mm" in Asia/Tokyo for a UTC instant. */
export function tokyoTimeLabel(instantIso: string): string {
  const tokyo = tokyoLocalInstant(instantIso);
  const hours = String(tokyo.getUTCHours()).padStart(2, '0');
  const minutes = String(tokyo.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** "2026年8月10日" in Asia/Tokyo for a UTC instant. */
export function tokyoDateLabel(instantIso: string): string {
  const tokyo = tokyoLocalInstant(instantIso);
  return `${String(tokyo.getUTCFullYear())}年${String(tokyo.getUTCMonth() + 1)}月${String(tokyo.getUTCDate())}日`;
}

/** Compact Japanese display for an Event's inclusive date-only range.
 * `startsOn`/`endsOn` are calendar dates, not instants, so this intentionally
 * validates and formats their fields directly without applying a timezone
 * conversion. */
export function eventDateRangeLabel(startsOn: string, endsOn: string): string {
  const start = parseTokyoCalendarDate(startsOn);
  const end = parseTokyoCalendarDate(endsOn);
  const dateLabel = (date: typeof start, includeYear: boolean): string =>
    `${includeYear ? `${String(date.year)}年` : ''}${String(date.month)}月${String(date.day)}日`;

  if (startsOn === endsOn) {
    return dateLabel(start, false);
  }

  const sameYear = start.year === end.year;
  const startLabel = dateLabel(start, !sameYear);
  const endLabel =
    start.year === end.year && start.month === end.month
      ? `${String(end.day)}日`
      : dateLabel(end, !sameYear);
  return `${startLabel}〜${endLabel}`;
}

export const UNKNOWN_END_TIME_LABEL = '終了時刻未定';
const NEXT_DAY_SUFFIX = '（翌日）';

/**
 * "11:00〜16:00" when both times are known. `endsAt === null` (unset end
 * time) is a valid product state (docs/prd.md / product-rules.md「Nullable
 * end time」), never coerced to a fabricated duration/default - this
 * renders an explicit "終了時刻未定" label instead, so an unknown end is
 * never visually indistinguishable from one that was simply left off.
 *
 * When a known end time falls on the *next* Tokyo calendar day (e.g. a
 * show starting 23:00 and ending past midnight), the end time alone would
 * render as a smaller number than the start ("23:00〜00:30"), which reads
 * as backwards. Marking it "00:30（翌日）" disambiguates it from a
 * same-day data error without needing to show a full date.
 */
export function occurrenceTimeRangeLabel(startsAt: string, endsAt: string | null): string {
  const start = tokyoTimeLabel(startsAt);
  if (endsAt === null) {
    return `${start}〜（${UNKNOWN_END_TIME_LABEL}）`;
  }
  const end = tokyoTimeLabel(endsAt);
  const spansToNextDay =
    tokyoCalendarDateFromInstant(endsAt) !== tokyoCalendarDateFromInstant(startsAt);
  return spansToNextDay ? `${start}〜${end}${NEXT_DAY_SUFFIX}` : `${start}〜${end}`;
}

const RENDERABLE_URL_SCHEMES = new Set(['http:', 'https:']);

/**
 * True iff `value` is an absolute http(s) URL. `event.sourceUrl` is
 * free-form text an event owner supplies (the create/update RPC applies no
 * scheme allowlist - see supabase/migrations), so a read-only viewer
 * rendering it as a clickable `<a href>` must check this first: an
 * unchecked `javascript:`/`data:`/etc. scheme would otherwise execute in
 * whichever other authenticated user's session clicks it (see
 * src/app/catalog/_components/EventDetail.tsx).
 */
export function isRenderableHttpUrl(value: string): boolean {
  try {
    return RENDERABLE_URL_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
