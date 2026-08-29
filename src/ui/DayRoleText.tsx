import type { CSSProperties, ElementType, ReactNode } from 'react';
import type { CalendarDayRole } from '@/domain/calendarDayRole.ts';

export interface DayRoleTextProps {
  role: CalendarDayRole;
  /** Defaults to `span` - callers pass their own heading/paragraph tag
   * (`h2`/`h3`/`p`) so this stays reusable across the different list-date
   * surfaces (Issue #189: Home upcoming heading, Catalog/My Calendar
   * selected-date heading, Tickets date column). */
  as?: ElementType;
  className?: string;
  children: ReactNode;
  /** Forwarded to the rendered tag - e.g. a holiday's accessible name
   * (`calendarDateAccessibleWeekdayLabel`) for a surface with no other
   * natural non-color announcement of its own (Tickets' date column has no
   * wrapping `aria-label`, unlike Home/Catalog/My Calendar's `<section>`). */
  'aria-label'?: string;
}

/** Issue #189's own canonical color table: Sunday / confirmed Japanese
 * holiday -> `#a13b2e` (`--color-danger`), Saturday -> `#2f4a7a`
 * (`--color-accent`). `'weekday'` has no entry: it always inherits the
 * caller's own text color (`--color-text` in every current consumer),
 * never overridden here.
 *
 * For holiday and Saturday this happens to be the exact same token the
 * month calendar's own day-role CSS already pairs with those roles (see
 * `.day.roleHoliday`/`.day.roleSaturday` in MonthCalendar.module.css /
 * MyMonthCalendar.module.css, which this component does not touch - those
 * stay a separate, out-of-scope styling surface). Sunday is the one
 * exception: the calendar's own `.day.roleSunday` still points at
 * `--color-calendar-sunday` (tokens.css), which currently resolves to
 * `--color-status-danger-500` (`#b3413a`) - a distinct, not-yet-repinned
 * value the calendar CSS's own comment (Issue #142) explains was
 * deliberately kept separate from `--color-danger` pending a later
 * convergence. This component uses `--color-danger` for Sunday because
 * that is Issue #189's explicit canonical value (the table above), and
 * repinning `--color-calendar-sunday`/the calendar's own CSS is calendar
 * cell redesign - out of scope for this Task. The 4 list-date surfaces
 * this component serves are therefore internally consistent with each
 * other and with Issue #189's table, but a Sunday list-date and a Sunday
 * calendar cell do not yet render the identical red until a future Task
 * repins `--color-calendar-sunday` to close that gap. */
const ROLE_COLOR: Partial<Record<CalendarDayRole, string>> = {
  holiday: 'var(--color-danger)',
  sunday: 'var(--color-danger)',
  saturday: 'var(--color-accent)',
};

/**
 * The single shared color authority for a list-date's weekday/holiday role
 * (Issue #189 Task Contract): every list-date surface renders its own
 * "M月D日（曜）" text (`calendarDateWeekdayLabel`) through this component
 * rather than holding its own role -> color mapping. Applies color as an
 * inline style (not a CSS Module class) so it always wins regardless of
 * each screen's own CSS Module import order/specificity - screens keep
 * their own font-size/weight styling via `className`.
 */
export function DayRoleText({
  role,
  as: Tag = 'span',
  className,
  children,
  'aria-label': ariaLabel,
}: DayRoleTextProps) {
  const color = ROLE_COLOR[role];
  const style: CSSProperties | undefined = color !== undefined ? { color } : undefined;
  return (
    <Tag className={className} style={style} aria-label={ariaLabel}>
      {children}
    </Tag>
  );
}
