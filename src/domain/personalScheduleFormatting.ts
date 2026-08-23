import { tokyoDateLabel, tokyoTimeLabel, UNKNOWN_END_TIME_LABEL } from './catalogFormatting.ts';
import { parseTokyoCalendarDate } from './eventCatalog.ts';
import type { ScheduleTemporal, ScheduleType } from './personalSchedule.ts';

// Pure display formatting for the personal schedule feature (Issue #37).
// Reuses catalogFormatting.ts's Asia/Tokyo instant formatters so an instant
// renders identically everywhere in the product, rather than reimplementing
// the same +9h conversion a second time.

const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  paid_leave: '有給休暇',
  work: '仕事',
  travel: '遠征',
  other: 'その他',
};

export function scheduleTypeLabel(scheduleType: ScheduleType): string {
  return SCHEDULE_TYPE_LABELS[scheduleType];
}

/** "2026年8月10日" for a single-day all-day entry, "2026年8月10日〜2026年8月12日"
 * for a multi-day one. startsOn/endsOn are plain calendar dates already
 * (no instant conversion needed - see personalSchedule.ts's ScheduleTemporal). */
function allDayLabel(startsOn: string, endsOn: string): string {
  // Round-trips through parseTokyoCalendarDate so a malformed persisted
  // value fails loudly here rather than being echoed verbatim - matching
  // this module's instant-based formatters, which throw the same way via
  // tokyoLocalInstant on an unparseable instant.
  parseTokyoCalendarDate(startsOn);
  parseTokyoCalendarDate(endsOn);
  const startLabel = tokyoDateLabel(new Date(`${startsOn}T00:00:00Z`).toISOString());
  if (startsOn === endsOn) {
    return startLabel;
  }
  const endLabel = tokyoDateLabel(new Date(`${endsOn}T00:00:00Z`).toISOString());
  return `${startLabel}〜${endLabel}`;
}

/** "2026年8月10日 19:00〜21:00" (or "…（終了時刻未定）" when unset), for a
 * time-bounded entry - deliberately always includes the date, unlike
 * catalogFormatting.ts's occurrenceTimeRangeLabel, since a personal
 * schedule listing (unlike a single day's occurrence list) is not already
 * grouped under a date heading. */
function timeBoundedLabel(startsAt: string, endsAt: string | null): string {
  const dateLabel = tokyoDateLabel(startsAt);
  const startTimeLabel = tokyoTimeLabel(startsAt);
  if (endsAt === null) {
    return `${dateLabel} ${startTimeLabel}〜（${UNKNOWN_END_TIME_LABEL}）`;
  }
  return `${dateLabel} ${startTimeLabel}〜${tokyoTimeLabel(endsAt)}`;
}

export function scheduleTemporalLabel(temporal: ScheduleTemporal): string {
  return temporal.kind === 'all-day'
    ? allDayLabel(temporal.startsOn, temporal.endsOn)
    : timeBoundedLabel(temporal.startsAt, temporal.endsAt);
}
