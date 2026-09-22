export const HAS_UTC_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
export const HAS_CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const CALENDAR_DATE_COMPONENTS = /^(\d{4})-(\d{2})-(\d{2})$/;
const CALENDAR_DATETIME_COMPONENTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidCalendarDate(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isValidClockTime(hour, minute, second) {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/** Rejects shape-valid but impossible proleptic Gregorian calendar dates. */
export function isValidCalendarDateString(value) {
  const match = CALENDAR_DATE_COMPONENTS.exec(value);
  if (match === null) return false;
  return isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Rejects timestamps whose local calendar or clock components are impossible. */
export function isValidCalendarDateTimeString(value) {
  const match = CALENDAR_DATETIME_COMPONENTS.exec(value);
  if (match === null) return false;
  const [, year, month, day, hour, minute, second] = match;
  if (!isValidCalendarDate(Number(year), Number(month), Number(day))) return false;
  return isValidClockTime(Number(hour), Number(minute), second === undefined ? 0 : Number(second));
}
