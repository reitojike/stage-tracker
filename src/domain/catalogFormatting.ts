import { TOKYO_OFFSET_MS } from './eventCatalog.ts';

// Pure Asia/Tokyo display formatting for the Catalog feature (Issue #20).
// Uses the same fixed +9h offset as the rest of this domain (never the JS
// runtime's local timezone) to turn a UTC instant into Tokyo local
// hour/minute/date fields for display.

function tokyoLocalParts(instantIso: string): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
} {
  const instantMs = Date.parse(instantIso);
  if (Number.isNaN(instantMs)) {
    throw new Error(`expected a valid ISO 8601 instant, got: ${instantIso}`);
  }
  const tokyo = new Date(instantMs + TOKYO_OFFSET_MS);
  return {
    year: tokyo.getUTCFullYear(),
    month: tokyo.getUTCMonth() + 1,
    day: tokyo.getUTCDate(),
    hours: tokyo.getUTCHours(),
    minutes: tokyo.getUTCMinutes(),
  };
}

/** "HH:mm" in Asia/Tokyo for a UTC instant. */
export function tokyoTimeLabel(instantIso: string): string {
  const { hours, minutes } = tokyoLocalParts(instantIso);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "2026年8月10日" in Asia/Tokyo for a UTC instant. */
export function tokyoDateLabel(instantIso: string): string {
  const { year, month, day } = tokyoLocalParts(instantIso);
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

export const UNKNOWN_END_TIME_LABEL = '終了時刻未定';

/**
 * "11:00〜16:00" when both times are known. `endsAt === null` (unset end
 * time) is a valid product state (product-rules.md「Nullable end time」),
 * never coerced to a fabricated duration/default - this renders an
 * explicit "終了時刻未定" label instead, so an unknown end is never
 * visually indistinguishable from one that was simply left off.
 */
export function occurrenceTimeRangeLabel(startsAt: string, endsAt: string | null): string {
  const start = tokyoTimeLabel(startsAt);
  if (endsAt === null) {
    return `${start}〜（${UNKNOWN_END_TIME_LABEL}）`;
  }
  return `${start}〜${tokyoTimeLabel(endsAt)}`;
}
