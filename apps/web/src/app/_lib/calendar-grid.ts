import {
  tokyoCalendarDateSchema,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";

/**
 * Month-grid calendar arithmetic shared by `/calendar` and `/catalog` (both
 * render a month calendar per `docs/v2/oracle-routes-ui.md` §2). This is
 * deliberately *not* in `@stage-tracker/domain`: it is UI-layer "which cells
 * does a calendar grid need" arithmetic, not a product invariant - unlike
 * `@stage-tracker/domain`'s `TokyoCalendarDate` parsing (which exists to
 * *reject* malformed input), the month-shifting here uses plain
 * `Date.UTC`-based day arithmetic and only re-validates the final formatted
 * string through `tokyoCalendarDateSchema` at the boundary.
 */

export interface TokyoYearMonth {
  readonly year: number;
  readonly month: number; // 1-12
}

const MONTH_PARAM_PATTERN = /^(\d{4})-(\d{2})$/u;

/** Parses a `?month=YYYY-MM` search param. Falls back (never throws) on a
 * missing/malformed/out-of-range value, matching the oracle's "不正値は今日
 * にフォールバック" rule for calendar params. */
export function parseMonthParam(
  raw: string | undefined,
  fallback: TokyoYearMonth,
): TokyoYearMonth {
  if (raw === undefined) {
    return fallback;
  }
  const match = MONTH_PARAM_PATTERN.exec(raw);
  if (match === null) {
    return fallback;
  }
  const [, yearStr, monthStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month < 1 || month > 12) {
    return fallback;
  }
  return { year, month };
}

export function formatMonthParam(yearMonth: TokyoYearMonth): string {
  return `${String(yearMonth.year).padStart(4, "0")}-${String(yearMonth.month).padStart(2, "0")}`;
}

export function tokyoYearMonthOf(date: TokyoCalendarDate): TokyoYearMonth {
  const [yearStr, monthStr] = date.split("-");
  return { year: Number(yearStr), month: Number(monthStr) };
}

/** Parses a `?date=YYYY-MM-DD` search param via the domain's own validator.
 * Returns `null` (never throws) for a missing/malformed value - callers
 * decide their own fallback (the oracle's "月ランディング" `null` state for
 * `/calendar`, or simply "no day selected" for `/catalog`). */
export function parseDateParam(
  raw: string | undefined,
): TokyoCalendarDate | null {
  if (raw === undefined) {
    return null;
  }
  const parsed = tokyoCalendarDateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The month/selected-day pair `/calendar` renders, resolved from a
 * possibly missing/malformed `month`/`date` search param pair (contract:
 * legacy `resolveCatalogParams`/`resolveMyCalendarParams` in
 * `apps/legacy-web/src/domain/catalogNavigation.ts`, reused verbatim by
 * `/calendar` there). A valid `date` always wins for the displayed month -
 * a `month` param that disagreed with it would otherwise let the grid and
 * the selected-day section drift onto different months. Only when `date`
 * is missing/invalid does `month` (or, failing that, `fallback`) apply, and
 * the selected day is `null`. Malformed values are ignored rather than
 * surfaced as an error: this is client-supplied navigation state, not
 * domain data. */
export function resolveCalendarMonthAndDate(
  rawMonth: string | undefined,
  rawDate: string | undefined,
  fallback: TokyoYearMonth,
): { month: TokyoYearMonth; selectedDate: TokyoCalendarDate | null } {
  const selectedDate = parseDateParam(rawDate);
  if (selectedDate !== null) {
    return { month: tokyoYearMonthOf(selectedDate), selectedDate };
  }
  return { month: parseMonthParam(rawMonth, fallback), selectedDate: null };
}

function dateFromYmd(
  year: number,
  month: number,
  day: number,
): TokyoCalendarDate {
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  const formatted = `${String(asUtc.getUTCFullYear()).padStart(4, "0")}-${String(
    asUtc.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(asUtc.getUTCDate()).padStart(2, "0")}`;
  return tokyoCalendarDateSchema.parse(formatted);
}

export function firstDayOfMonth(yearMonth: TokyoYearMonth): TokyoCalendarDate {
  return dateFromYmd(yearMonth.year, yearMonth.month, 1);
}

/** Day 0 of "next month" is the last day of `yearMonth`'s month - relies on
 * `Date.UTC`'s ordinary (non-validating) overflow/underflow normalization,
 * which is exactly what calendar month-arithmetic wants here. */
export function lastDayOfMonth(yearMonth: TokyoYearMonth): TokyoCalendarDate {
  return dateFromYmd(yearMonth.year, yearMonth.month + 1, 0);
}

export function addMonths(
  yearMonth: TokyoYearMonth,
  delta: number,
): TokyoYearMonth {
  const totalMonthsFromEpoch =
    yearMonth.year * 12 + (yearMonth.month - 1) + delta;
  const year = Math.floor(totalMonthsFromEpoch / 12);
  const month = ((totalMonthsFromEpoch % 12) + 12) % 12;
  return { year, month: month + 1 };
}

function splitYmd(date: TokyoCalendarDate): [number, number, number] {
  const [yearStr, monthStr, dayStr] = date.split("-");
  return [Number(yearStr), Number(monthStr), Number(dayStr)];
}

export function addDays(
  date: TokyoCalendarDate,
  delta: number,
): TokyoCalendarDate {
  const [year, month, day] = splitYmd(date);
  return dateFromYmd(year, month, day + delta);
}

/** 0 = Sunday, matching `Date.prototype.getUTCDay()`. */
export function dayOfWeek(date: TokyoCalendarDate): number {
  const [year, month, day] = splitYmd(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The full 7-column grid of `TokyoCalendarDate`s covering every week that
 * touches `yearMonth`'s month (leading/trailing adjacent-month days
 * included, matching a conventional month calendar). Always a multiple of 7
 * in length.
 */
export function buildMonthGridDays(
  yearMonth: TokyoYearMonth,
): readonly TokyoCalendarDate[] {
  const first = firstDayOfMonth(yearMonth);
  const last = lastDayOfMonth(yearMonth);
  const gridStart = addDays(first, -dayOfWeek(first));
  const gridEnd = addDays(last, 6 - dayOfWeek(last));

  const days: TokyoCalendarDate[] = [];
  let cursor = gridStart;
  // Fixed-width "YYYY-MM-DD" strings compare lexicographically in the same
  // order as chronologically (same property `compareTokyoCalendarDates`
  // relies on), so a plain `<=` string comparison is a safe loop bound.
  while (cursor <= gridEnd) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

const WEEKDAY_LABELS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

export function weekdayLabelJa(date: TokyoCalendarDate): string {
  return WEEKDAY_LABELS_JA[dayOfWeek(date)] ?? "";
}

export function maxTokyoCalendarDate(
  a: TokyoCalendarDate,
  b: TokyoCalendarDate,
): TokyoCalendarDate {
  return a >= b ? a : b;
}

export function minTokyoCalendarDate(
  a: TokyoCalendarDate,
  b: TokyoCalendarDate,
): TokyoCalendarDate {
  return a <= b ? a : b;
}

/** Every date in the inclusive `[start, end]` range, ascending. Returns an
 * empty array if `start` is after `end` (a caller clamping a span against a
 * visible window uses this to represent "no overlap" rather than treating it
 * as an error). */
export function enumerateTokyoCalendarDates(
  start: TokyoCalendarDate,
  end: TokyoCalendarDate,
): readonly TokyoCalendarDate[] {
  if (start > end) {
    return [];
  }
  const dates: TokyoCalendarDate[] = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}
