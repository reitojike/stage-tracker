import type { CalendarDayRole } from "./calendar-day-role";

/** Shared non-color presentation for month-calendar day roles. */
export function roleTextClassName(role: CalendarDayRole): string | undefined {
  if (role === "holiday") {
    return "text-calendar-holiday font-semibold";
  }
  if (role === "saturday") {
    return "text-calendar-saturday";
  }
  if (role === "sunday") {
    return "text-calendar-sunday";
  }
  return undefined;
}

/**
 * Month-calendar bands use the same plain-text cancellation marker on every
 * surface. This keeps cancellation distinguishable without depending on
 * color, while each consumer remains responsible for its own band meaning.
 */
export function bandDisplayTitle(
  eventTitle: string,
  isCanceled: boolean,
): string {
  return isCanceled ? `${eventTitle}（中止）` : eventTitle;
}
