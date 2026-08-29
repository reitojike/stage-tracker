import type { ParticipationStatus } from './participation.ts';
import { parseTokyoCalendarDate, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import { tokyoTimeLabel } from './catalogFormatting.ts';
import { scheduleTemporalLabel } from './personalScheduleFormatting.ts';
import type { ScheduleTemporal } from './personalSchedule.ts';

// Pure display formatting for My Calendar (Issue #34).

/** Mirrors src/app/catalog/_components/OccurrenceParticipationRow.tsx's own
 * participation labels ("参加する" / "気になる") so the same status reads
 * identically everywhere in the product. */
export function participationStatusLabel(status: ParticipationStatus): string {
  return status === 'attending' ? '参加する' : '気になる';
}

/** "9月11日" - bare month/day, no year, no weekday (Issue #196: the
 * selected-day add-row/empty-state copy's `{M月D日}に予定を追加` template
 * needs just this, distinct from calendarDayRole.ts's own
 * calendarDateWeekdayLabel, which always includes the weekday in
 * parentheses for its own list-date-heading purpose). */
export function myCalendarMonthDayLabel(tokyoDate: string): string {
  const { month, day } = parseTokyoCalendarDate(tokyoDate);
  return `${String(month)}月${String(day)}日`;
}

function monthDayFromInstant(instantIso: string): string {
  return myCalendarMonthDayLabel(tokyoCalendarDateFromInstant(instantIso));
}

/** Compact same-year variant of allDayLabel's own multi-day range
 * ("2026年9月11日〜2026年9月13日" -> "9月11日〜13日") - see
 * myCalendarScheduleTemporalLabel's header for why this is a My-Calendar-
 * local helper rather than a change to personalScheduleFormatting.ts's
 * shared scheduleTemporalLabel. */
function compactAllDayRangeLabel(startsOn: string, endsOn: string): string {
  const start = parseTokyoCalendarDate(startsOn);
  const end = parseTokyoCalendarDate(endsOn);
  if (start.year !== end.year) {
    // Issue #196: "year boundary を跨ぐ場合だけ year を表示" - fall back to
    // the shared formatter's own full "YYYY年M月D日〜YYYY年M月D日" output.
    return scheduleTemporalLabel({ kind: 'all-day', startsOn, endsOn });
  }
  if (start.month === end.month) {
    return `${String(start.month)}月${String(start.day)}日〜${String(end.day)}日`;
  }
  return `${myCalendarMonthDayLabel(startsOn)}〜${myCalendarMonthDayLabel(endsOn)}`;
}

/** Compact same-year variant of timeBoundedLabel's own next-day-spanning
 * range ("2026年3月1日 23:00〜2026年3月2日 01:00" -> "3月1日 23:00〜3月2日
 * 01:00") - drops the year only; the time-of-day precision each side
 * already carries is untouched (Issue #196: "all-day/time-bounded semantic
 * precisionを変えない"). */
function compactTimeBoundedRangeLabel(startsAt: string, endsAt: string): string {
  const startDate = tokyoCalendarDateFromInstant(startsAt);
  const endDate = tokyoCalendarDateFromInstant(endsAt);
  const startYear = parseTokyoCalendarDate(startDate).year;
  const endYear = parseTokyoCalendarDate(endDate).year;
  if (startYear !== endYear) {
    return scheduleTemporalLabel({ kind: 'time-bounded', startsAt, endsAt });
  }
  return `${monthDayFromInstant(startsAt)} ${tokyoTimeLabel(startsAt)}〜${monthDayFromInstant(endsAt)} ${tokyoTimeLabel(endsAt)}`;
}

/**
 * My Calendar's own selected-day secondary label for a personal-schedule
 * entry (Issue #196 "Date range formatting"): compacts a same-year
 * multi-day *range* by dropping the redundant repeated year, while leaving
 * every single-date label (no range at all) exactly as
 * personalScheduleFormatting.ts's shared scheduleTemporalLabel already
 * renders it.
 *
 * This is a bounded, My-Calendar-local wrapper rather than a change to the
 * shared scheduleTemporalLabel itself: that function also backs Home's
 * upcoming list and the Personal Schedule management screens (Issue #194's
 * own scope), and Issue #196 explicitly scopes the compact-range
 * requirement to "My Calendar selected-day presentation" only - changing
 * the shared formatter's output would silently change those other
 * surfaces too.
 */
export function myCalendarScheduleTemporalLabel(temporal: ScheduleTemporal): string {
  if (temporal.kind === 'all-day') {
    return temporal.startsOn === temporal.endsOn
      ? scheduleTemporalLabel(temporal)
      : compactAllDayRangeLabel(temporal.startsOn, temporal.endsOn);
  }
  if (temporal.endsAt === null) {
    return scheduleTemporalLabel(temporal);
  }
  const spansToAnotherDay =
    tokyoCalendarDateFromInstant(temporal.endsAt) !==
    tokyoCalendarDateFromInstant(temporal.startsAt);
  return spansToAnotherDay
    ? compactTimeBoundedRangeLabel(temporal.startsAt, temporal.endsAt)
    : scheduleTemporalLabel(temporal);
}
