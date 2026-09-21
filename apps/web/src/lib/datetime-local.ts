import { tokyoWallClockToInstant, type Instant } from "@stage-tracker/domain";

/** Syntax accepted by a datetime-local consumer at the write boundary. */
export type DateTimeLocalSyntax = "minute-only" | "optional-seconds";

export type ParseDateTimeLocalResult =
  | { readonly kind: "ok"; readonly value: Instant }
  | { readonly kind: "invalid-format" }
  | { readonly kind: "invalid-calendar-time" };

const MINUTE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;
const OPTIONAL_SECONDS_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

/**
 * Parse an HTML `datetime-local` value and convert its Tokyo wall-clock value
 * to an `Instant`. Syntax policy stays with the consumer; calendar validity is
 * delegated to the domain conversion so rollover can never be accepted.
 */
export function parseDateTimeLocal(
  raw: string,
  options: { readonly syntax: DateTimeLocalSyntax },
): ParseDateTimeLocalResult {
  const pattern =
    options.syntax === "minute-only"
      ? MINUTE_ONLY_PATTERN
      : OPTIONAL_SECONDS_PATTERN;
  const match = pattern.exec(raw.trim());
  if (match === null) {
    return { kind: "invalid-format" };
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  if (
    yearStr === undefined ||
    monthStr === undefined ||
    dayStr === undefined ||
    hourStr === undefined ||
    minuteStr === undefined
  ) {
    return { kind: "invalid-format" };
  }

  const result = tokyoWallClockToInstant({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
    hour: Number(hourStr),
    minute: Number(minuteStr),
    second: secondStr === undefined ? 0 : Number(secondStr),
  });
  return result.ok
    ? { kind: "ok", value: result.value }
    : { kind: "invalid-calendar-time" };
}
