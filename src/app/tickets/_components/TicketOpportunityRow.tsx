import type { ReactNode } from 'react';
import Link from 'next/link';
import { Badge, type BadgeVariant } from '@/ui/Badge';
import { DayRoleText } from '@/ui/DayRoleText';
import { isRenderableHttpUrl } from '@/domain/catalogFormatting.ts';
import { catalogEventHref } from '@/domain/catalogNavigation.ts';
import {
  formatTicketOpportunityMilestoneDisplay,
  isTicketOpportunityRowEffectivelyCanceled,
  ticketOpportunityDeadlineBadge,
  ticketOpportunityMilestoneTokyoCalendarDate,
  ticketOpportunityMilestoneTypeLabel,
  ticketOpportunityStateBadgeVariant,
  ticketOpportunityStateLabel,
  ticketOpportunityTargetScopeSummaryLabel,
} from '@/domain/ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineRow as TimelineRow } from '@/domain/ticketOpportunityTimeline.ts';
import { TicketOpportunityStateControls } from './TicketOpportunityStateControls.tsx';
import styles from './TicketOpportunityRow.module.css';

export interface TicketOpportunityRowProps {
  row: TimelineRow;
  /** Asia/Tokyo "today", passed down from the server component so no
   * component here reads the clock itself (matches src/app/tickets/_lib/
   * today.ts's own single-clock-read-per-request convention). */
  todayTokyoDate: string;
}

/** The row's own whole-row Event-detail link (Issue #197). Derives a
 * best-effort month/day navigation context from the row's own displayed
 * milestone date (ticketOpportunityMilestoneTokyoCalendarDate) - this row
 * has no single Occurrence of its own to focus (it is Opportunity/milestone
 * granularity, not Occurrence granularity - product-rules.md "Ticket
 * Opportunity"), so unlike Home/My Calendar's own catalogEventHref callers
 * this never passes an occurrenceId. */
function ticketOpportunityRowEventHref(row: TimelineRow): string {
  const date = ticketOpportunityMilestoneTokyoCalendarDate(row);
  return catalogEventHref(row.eventId, { yearMonth: date.slice(0, 7), selectedDate: date });
}

/**
 * Splits `calendarDateWeekdayLabel`'s own stable "M月D日（曜）" (or window
 * "M月D日（曜） 〜 M月D日（曜）") format so the full-width weekday
 * parentheses can render smaller/lighter (Issue #197: "weekday text 14px /
 * 400") than the day-of-month numerals beside them, without the domain
 * formatting module itself splitting its return value into parts - this is
 * presentation-only re-parsing of an already-documented, stable string
 * shape (calendarDayRole.ts's own calendarDateWeekdayLabel header), not a
 * new domain concept.
 */
function renderDateLabelWithWeekdayEmphasis(label: string): ReactNode {
  return label.split(/(（[^）]*）)/g).map((part, index) =>
    /^（[^）]*）$/.test(part) ? (
      <span key={index} className={styles.weekday}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Issue #197 body composition: `opportunityDisplayName` / `eventVenue` are
 * the only source-backed fields this MVP has (no ticket-type field/schema -
 * see this file's own legacy-vocabulary test guard) - composed into one
 * compact secondary line rather than two separate lines, never
 * reinterpreted into a generic ticket-type concept. */
function compactSecondaryLine(row: Pick<TimelineRow, 'eventVenue' | 'opportunityDisplayName'>) {
  return row.eventVenue !== null
    ? `${row.eventVenue}・${row.opportunityDisplayName}`
    : row.opportunityDisplayName;
}

interface RowStateBadge {
  variant: BadgeVariant;
  label: string;
}

/**
 * Issue #197 "State Badge — max one" precedence: a row shows at most one
 * state-style Badge, chosen in this exact order -
 * 1. whole-Opportunity effective cancellation (Issue #172) -> terminal/中止
 * 2. bounded post-final retained history (Issue #192) -> terminal/受付終了
 * 3. personal `applied` -> done/申し込み済み
 * 4. personal `planned` -> subtle/申し込む予定
 * 5. no personal state -> no badge at all
 *
 * This never mutates or re-derives the underlying personal planning state
 * (myState itself, and the mutation control's own gating below, are
 * unchanged) - it only decides which single Badge the row surfaces.
 * ticketOpportunityDeadlineBadge (#191's own remaining/deadline badge) is a
 * separate date-column temporal cue, not part of this "1 state badge" slot.
 */
function ticketOpportunityRowStateBadge(
  row: TimelineRow,
  isCanceled: boolean,
): RowStateBadge | null {
  if (isCanceled) {
    return { variant: 'terminal', label: '中止' };
  }
  if (row.isPostFinalRetainedHistory) {
    return { variant: 'terminal', label: '受付終了' };
  }
  if (row.myState !== null) {
    return {
      variant: ticketOpportunityStateBadgeVariant(row.myState),
      label: ticketOpportunityStateLabel(row.myState),
    };
  }
  return null;
}

/**
 * One "1 milestone = 1 schedule row" (Issue #144 Task Contract), refined into
 * the TURN 12 compact presentation (Issue #197): a 7.1em left date column
 * (milestone name / date / time / #191 deadline badge, top to bottom) and a
 * body column (a single state Badge, Event title, compact source-backed
 * secondary line, selected-target summary, quiet actions). The personal-state
 * mutation control only renders for row.isFirstRowForOpportunity - every
 * other row for the same Opportunity still shows the same current state as
 * the quiet state Badge above, so state reads consistently across every row
 * without repeating the control.
 *
 * A row can also be Issue #192's bounded post-final terminal history
 * (row.isPostFinalRetainedHistory) - the terminal `受付終了` state Badge for
 * that case defers to the existing whole-Opportunity `中止` Badge whenever
 * both are true, never showing both at once (see
 * ticketOpportunityRowStateBadge). Such a row never renders the
 * personal-state mutation control either - its application window has
 * already objectively closed, so offering
 * `申し込む予定にする`/`申し込み済みにする` would let a caller newly register
 * planning state against an Opportunity nothing can still be done for.
 *
 * A retained row is never also fed to Issue #191's own
 * ticketOpportunityDeadlineBadge below. That function classifies purely by
 * Asia/Tokyo *calendar-day* difference (see its own header), so a planned
 * application_close row whose deadline calendar day is still today but
 * whose exact instant has already elapsed (datetime/window precision) is
 * itself already past by isTicketOpportunityTimelineRowPast's instant
 * comparison - and hence already isPostFinalRetainedHistory-eligible - yet
 * ticketOpportunityDeadlineBadge would still classify it as the non-
 * terminal `本日 HH:MMまで`, not `terminal`/受付終了, for that same calendar
 * day. Unconditionally skipping it here (rather than trusting it to always
 * resolve to the identical terminal label) is what keeps a retained row's
 * terminal vocabulary from ever being contradicted by a still-looks-
 * actionable deadline badge for a deadline that has, in fact, already
 * passed. #191's classification authority itself is unchanged; this is
 * presentation-layer de-duplication only.
 *
 * Whole-row Event-detail link: a dedicated `Link` absolutely positioned to
 * cover the entire row (`.rowLink`, `.row` itself is `position: relative`)
 * rather than wrapping the row's visible content in an anchor - the state
 * mutation control (a `<form>` of `<button>`s) and the official-source `<a>`
 * cannot legally nest inside another `<a>`. The row-link's own accessible
 * name comes from a visually-hidden (sr-only) text node, not from wrapping
 * the visible title/date text, so nothing is announced twice. The quiet
 * actions block (`.actions`) is given `position: relative` with a higher
 * z-index so its buttons/link stay independently clickable/focusable above
 * the stretched overlay instead of triggering row navigation.
 */
export function TicketOpportunityRow({ row, todayTokyoDate }: TicketOpportunityRowProps) {
  const display = formatTicketOpportunityMilestoneDisplay(row);
  const deadlineBadge = row.isPostFinalRetainedHistory
    ? null
    : ticketOpportunityDeadlineBadge(row, todayTokyoDate);
  const isCanceled = isTicketOpportunityRowEffectivelyCanceled(row);
  const stateBadge = ticketOpportunityRowStateBadge(row, isCanceled);

  return (
    <li className={styles.row}>
      <Link href={ticketOpportunityRowEventHref(row)} className={styles.rowLink}>
        <span className={styles.srOnly}>{row.eventTitle}の詳細を見る</span>
      </Link>

      <div className={styles.dateColumn}>
        <p className={styles.milestoneLabel}>
          {ticketOpportunityMilestoneTypeLabel(row.milestoneType)}
        </p>
        <DayRoleText
          as="p"
          role={display.role}
          className={styles.dateLabel}
          aria-label={display.accessibleDateLabel}
        >
          {renderDateLabelWithWeekdayEmphasis(display.dateLabel)}
        </DayRoleText>
        {display.timeLabel !== null ? (
          <p className={styles.timeLabel}>{display.timeLabel}</p>
        ) : null}
        {deadlineBadge !== null ? (
          <Badge variant={deadlineBadge.variant}>{deadlineBadge.label}</Badge>
        ) : null}
      </div>

      <div className={styles.body}>
        {stateBadge !== null ? (
          <div className={styles.badgeRow}>
            <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
          </div>
        ) : null}
        <p className={styles.eventTitle}>{row.eventTitle}</p>
        <p className={styles.secondaryLine}>{compactSecondaryLine(row)}</p>
        {row.targetScope === 'selected_occurrences' ? (
          <p className={styles.scopeSummary}>{ticketOpportunityTargetScopeSummaryLabel(row)}</p>
        ) : null}
        <div className={styles.actions}>
          {row.sourceUrl !== null && isRenderableHttpUrl(row.sourceUrl) ? (
            <a
              href={row.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.sourceLink}
            >
              公式情報
            </a>
          ) : null}
          {row.isFirstRowForOpportunity && !row.isPostFinalRetainedHistory ? (
            <TicketOpportunityStateControls
              opportunityId={row.opportunityId}
              myState={row.myState}
            />
          ) : null}
        </div>
      </div>

      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </li>
  );
}
