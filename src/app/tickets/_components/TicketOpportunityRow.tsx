import { Badge } from '@/ui/Badge';
import { isRenderableHttpUrl } from '@/domain/catalogFormatting.ts';
import {
  formatTicketOpportunityMilestoneDisplay,
  isActionableTicketOpportunityDeadline,
  ticketOpportunityDeadlineRemainingDaysLabel,
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

/**
 * One "1 milestone = 1 schedule row" (Issue #144 Task Contract). The
 * personal-state mutation control only renders for
 * row.isFirstRowForOpportunity - every other row for the same Opportunity
 * still shows the same current state as a quiet Badge, so state reads
 * consistently across every row without repeating the control.
 */
export function TicketOpportunityRow({ row, todayTokyoDate }: TicketOpportunityRowProps) {
  const display = formatTicketOpportunityMilestoneDisplay(row);
  const isActionableDeadline = isActionableTicketOpportunityDeadline(row, todayTokyoDate);
  const remainingLabel = ticketOpportunityDeadlineRemainingDaysLabel(row, todayTokyoDate);

  return (
    <li className={styles.row}>
      <div className={styles.dateColumn}>
        <p className={styles.dateLabel}>{display.dateLabel}</p>
        {display.timeLabel !== null ? (
          <p className={styles.timeLabel}>{display.timeLabel}</p>
        ) : null}
      </div>
      <div className={styles.body}>
        <div className={styles.badgeRow}>
          <Badge variant="outline">{ticketOpportunityMilestoneTypeLabel(row.milestoneType)}</Badge>
          {row.myState !== null ? (
            <Badge variant={ticketOpportunityStateBadgeVariant(row.myState)}>
              {ticketOpportunityStateLabel(row.myState)}
            </Badge>
          ) : null}
          {isActionableDeadline && remainingLabel !== null ? (
            <Badge variant="deadline">{remainingLabel}</Badge>
          ) : null}
        </div>
        <p className={styles.eventTitle}>{row.eventTitle}</p>
        {row.eventVenue !== null ? <p className={styles.venue}>{row.eventVenue}</p> : null}
        <p className={styles.opportunityName}>{row.opportunityDisplayName}</p>
        <p className={styles.scopeSummary}>{ticketOpportunityTargetScopeSummaryLabel(row)}</p>
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
        {row.isFirstRowForOpportunity ? (
          <TicketOpportunityStateControls opportunityId={row.opportunityId} myState={row.myState} />
        ) : null}
      </div>
    </li>
  );
}
