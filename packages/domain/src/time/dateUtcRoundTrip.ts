/**
 * Internal helper shared by every calendar/date-time parser in this package.
 *
 * `Date.UTC(year, monthIndex, day, ...)` silently *normalizes* out-of-range
 * components instead of rejecting them: `Date.UTC(2026, 1, 30, ...)`
 * ("2026-02-30") quietly becomes 2026-03-02, and an hour of `24` rolls over
 * into the next day. Naively trusting `Date.UTC`'s return value would accept
 * calendar dates and wall-clock times that do not actually exist.
 *
 * `Date.UTC` (and the two/three-argument `Date` constructor family) also
 * remaps a two-digit `year` (0-99) to 1900+year - a legacy ECMAScript
 * behavior. A 4-digit-formatted year string like "0026" parses to the
 * *number* 26, which falls in that remapped range even though its string
 * form is already zero-padded to 4 digits, so the fix is at the numeric
 * level, not the string-shape level.
 *
 * This helper avoids both pitfalls by writing components onto a `Date` with
 * `setUTCFullYear`/`setUTCHours` (neither of which has the two-digit-year
 * quirk) and then reading the components back. If any component does not
 * round-trip exactly, the input combination does not correspond to a real
 * calendar date/time and `null` is returned.
 */
export interface UtcDateTimeComponents {
  readonly year: number;
  readonly month: number; // 1-12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

export function dateUtcRoundTripMs(components: UtcDateTimeComponents): number | null {
  const date = new Date(0);
  date.setUTCFullYear(components.year, components.month - 1, components.day);
  date.setUTCHours(components.hour, components.minute, components.second, components.millisecond);

  const roundTripped: UtcDateTimeComponents = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };

  const matches =
    roundTripped.year === components.year &&
    roundTripped.month === components.month &&
    roundTripped.day === components.day &&
    roundTripped.hour === components.hour &&
    roundTripped.minute === components.minute &&
    roundTripped.second === components.second &&
    roundTripped.millisecond === components.millisecond;

  return matches ? date.getTime() : null;
}
