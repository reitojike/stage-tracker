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

/** Sunday / confirmed holiday use semantic `--color-danger`; Saturday uses
 * semantic `--color-accent`. The list-date and calendar presentation reds
 * are now converged. Day-role derivation and holiday coverage remain owned
 * by their existing authority. `'weekday'` has no entry: it always inherits
 * the caller's own text color (`--color-text` in every current consumer),
 * never overridden here. */
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
