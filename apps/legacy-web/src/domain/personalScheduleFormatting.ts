import { tokyoDateLabel, tokyoTimeLabel, UNKNOWN_END_TIME_LABEL } from './catalogFormatting.ts';
import { parseTokyoCalendarDate, tokyoCalendarDateFromInstant } from './eventCatalog.ts';
import type { ScheduleTemporal } from './personalSchedule.ts';

// Pure display formatting for the personal schedule feature (Issue #37).
// Reuses catalogFormatting.ts's Asia/Tokyo instant formatters so an instant
// renders identically everywhere in the product, rather than reimplementing
// the same +9h conversion a second time.
//
// Issue #121 removed the closed schedule_type vocabulary this module used
// to label (scheduleTypeLabel): a PersonalScheduleEntry's free-form `title`
// is now the display label directly, with no formatting step of its own.

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
 * time-bounded entry - deliberately always includes the start date, unlike
 * catalogFormatting.ts's occurrenceTimeRangeLabel, since a personal
 * schedule listing (unlike a single day's occurrence list) is not already
 * grouped under a date heading.
 *
 * When the end instant falls on a *different* Tokyo calendar day than the
 * start (e.g. an overnight trip, or a work shift starting 23:00), the end
 * time alone would read as earlier than the start ("23:00〜01:00" looks
 * backwards) and could be misread as same-day. Unlike
 * occurrenceTimeRangeLabel (which only ever needs a "next day" suffix,
 * since a single performance never spans more than one extra day), a
 * personal schedule entry can span an arbitrary number of days, so this
 * shows the end's own date instead of a "+N日" label that would need to
 * count them - unambiguous regardless of how many days apart the two
 * instants are. */
function timeBoundedLabel(startsAt: string, endsAt: string | null): string {
  const dateLabel = tokyoDateLabel(startsAt);
  const startTimeLabel = tokyoTimeLabel(startsAt);
  if (endsAt === null) {
    return `${dateLabel} ${startTimeLabel}〜（${UNKNOWN_END_TIME_LABEL}）`;
  }
  const endTimeLabel = tokyoTimeLabel(endsAt);
  const spansToAnotherDay =
    tokyoCalendarDateFromInstant(endsAt) !== tokyoCalendarDateFromInstant(startsAt);
  return spansToAnotherDay
    ? `${dateLabel} ${startTimeLabel}〜${tokyoDateLabel(endsAt)} ${endTimeLabel}`
    : `${dateLabel} ${startTimeLabel}〜${endTimeLabel}`;
}

export function scheduleTemporalLabel(temporal: ScheduleTemporal): string {
  return temporal.kind === 'all-day'
    ? allDayLabel(temporal.startsOn, temporal.endsOn)
    : timeBoundedLabel(temporal.startsAt, temporal.endsAt);
}
