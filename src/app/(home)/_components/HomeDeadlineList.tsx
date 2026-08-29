import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import { tokyoCalendarDateFromInstant } from '@/domain/eventCatalog.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import {
  formatTicketOpportunityMilestoneDisplay,
  ticketOpportunityDeadlineBadge,
} from '@/domain/ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineRow } from '@/domain/ticketOpportunityTimeline.ts';
import styles from './HomeDeadlineList.module.css';

export interface HomeDeadlineListProps {
  /** Already selected via domain/homeDeadlines.ts's selectHomeDeadlineRows -
   * this component adds no actionability/ordering judgment of its own, only
   * renders what it is given. */
  rows: readonly TicketOpportunityTimelineRow[];
  todayTokyoDate: string;
}

/** The Event-detail deep-link href for a deadline card (Issue #194 TURN 12:
 * the card itself is now a navigation destination, unlike TURN <12's glance-
 * only card). A `selected_occurrences` row focuses its nearest target
 * Occurrence (already chronologically sorted - see
 * domain/ticketOpportunityTimeline.ts), matching the same
 * event+occurrence deep-link shape HomeUpcomingList uses. An `event_wide`
 * row has no Occurrence to focus, so it links to the Event alone; Home has
 * no month/day navigation state of its own to carry as context (same
 * reasoning as HomeUpcomingList's own occurrenceEventDetailContext), so
 * `todayTokyoDate` stands in for it. */
function deadlineCardHref(row: TicketOpportunityTimelineRow, todayTokyoDate: string): string {
  const firstTarget = row.targetOccurrences[0];
  if (firstTarget === undefined) {
    const context: CatalogParams = { yearMonth: todayTokyoDate.slice(0, 7), selectedDate: null };
    return catalogEventHref(row.eventId, context);
  }
  const date = tokyoCalendarDateFromInstant(firstTarget.startsAt);
  const context: CatalogParams = { yearMonth: date.slice(0, 7), selectedDate: date };
  return catalogEventHref(row.eventId, context, firstTarget.id);
}

/**
 * Home's "申し込み期限" block (Issue #143 Task Contract, refined by Issue
 * #194): a horizontal-scroll row of compact cards, one per actionable
 * deadline, each card now linking to its Event detail (Issue #194 TURN 12 -
 * supersedes TURN <12's "deliberately not a link" glance-only card). The
 * full Ticket Opportunity detail (source link, target scope, personal state
 * controls) still stays on /tickets; this card only ever navigates to the
 * Event, never reproduces Opportunity-level controls itself.
 *
 * Red fill is confined to the deadline Badge itself - the card face stays
 * neutral, so a result/sale/payment-type row elsewhere in the product is
 * never implied to carry the same urgency by mere visual proximity (this
 * list only ever contains actionable application_close rows to begin with,
 * but the card styling itself follows the same "red means an actionable
 * deadline, never a whole state block" rule as everywhere else - see
 * docs/ux-ui.md).
 *
 * The trailing chevron on the deadline line only appears when the source
 * milestone carries a time (display.timeLabel !== null) - a date-only
 * milestone shows no chevron, matching TURN 12, though the card itself
 * remains a link either way (Issue #194 Task Contract).
 */
export function HomeDeadlineList({ rows, todayTokyoDate }: HomeDeadlineListProps) {
  return (
    <ul className={styles.row}>
      {rows.map((row) => {
        const display = formatTicketOpportunityMilestoneDisplay(row);
        const deadlineBadge = ticketOpportunityDeadlineBadge(row, todayTokyoDate);
        return (
          <li key={row.id} className={styles.card}>
            <Link href={deadlineCardHref(row, todayTokyoDate)} className={styles.cardLink}>
              {deadlineBadge !== null ? (
                <Badge variant={deadlineBadge.variant} className={styles.badge}>
                  {deadlineBadge.label}
                </Badge>
              ) : null}
              <p className={styles.eventTitle}>{row.eventTitle}</p>
              <p className={styles.opportunityName}>{row.opportunityDisplayName}</p>
              <p className={styles.deadline}>
                <span>
                  {display.dateLabel}
                  {display.timeLabel !== null ? ` ${display.timeLabel}` : ''}
                </span>
                {display.timeLabel !== null ? (
                  <span className={styles.chevron} aria-hidden="true">
                    ›
                  </span>
                ) : null}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
