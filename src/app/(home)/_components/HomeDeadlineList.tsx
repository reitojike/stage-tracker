import { Badge } from '@/ui/Badge';
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

/**
 * Home's "申し込み期限" block (Issue #143 Task Contract): a horizontal-
 * scroll row of compact cards, one per actionable deadline. Red fill is
 * confined to the deadline Badge itself - the card face stays neutral, so a
 * result/sale/payment-type row elsewhere in the product is never implied to
 * carry the same urgency by mere visual proximity (this list only ever
 * contains actionable application_close rows to begin with, but the card
 * styling itself follows the same "red means an actionable deadline, never
 * a whole state block" rule as everywhere else - see docs/ux-ui.md).
 *
 * Deliberately not a link: this is a glance surface, not a new destination -
 * the full Ticket Opportunity detail (source link, target scope, personal
 * state controls) stays on /tickets (Issue #143 Task Contract: "Homeは
 * glance surfaceなので...shared Opportunity edit UIを追加しない").
 */
export function HomeDeadlineList({ rows, todayTokyoDate }: HomeDeadlineListProps) {
  return (
    <ul className={styles.row}>
      {rows.map((row) => {
        const display = formatTicketOpportunityMilestoneDisplay(row);
        const deadlineBadge = ticketOpportunityDeadlineBadge(row, todayTokyoDate);
        return (
          <li key={row.id} className={styles.card}>
            {deadlineBadge !== null ? (
              <Badge variant={deadlineBadge.variant} className={styles.badge}>
                {deadlineBadge.label}
              </Badge>
            ) : null}
            <p className={styles.eventTitle}>{row.eventTitle}</p>
            <p className={styles.opportunityName}>{row.opportunityDisplayName}</p>
            <p className={styles.deadline}>
              {display.dateLabel}
              {display.timeLabel !== null ? ` ${display.timeLabel}` : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
