import { Badge } from '@/ui/Badge';
import { isRenderableHttpUrl } from '@/domain/catalogFormatting.ts';
import {
  formatTicketOpportunityMilestoneDisplay,
  isTicketOpportunityRowEffectivelyCanceled,
  ticketOpportunityDeadlineBadge,
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
 *
 * A row can also be Issue #192's bounded post-final terminal history
 * (row.isPostFinalRetainedHistory) - the TURN 12 `受付終了` terminal badge
 * for that case defers to the existing whole-Opportunity `中止` badge
 * whenever both are true, never showing both at once (Task Contract:
 * "Retained rowはcurrent cancellation terminal `中止`を上書きしない"). Such a
 * row never renders the personal-state mutation control either - its
 * application window has already objectively closed, so offering
 * `申し込む予定にする`/`申し込み済みにする` would let a caller newly register
 * planning state against an Opportunity nothing can still be done for.
 */
export function TicketOpportunityRow({ row, todayTokyoDate }: TicketOpportunityRowProps) {
  const display = formatTicketOpportunityMilestoneDisplay(row);
  const deadlineBadge = ticketOpportunityDeadlineBadge(row, todayTokyoDate);
  const isCanceled = isTicketOpportunityRowEffectivelyCanceled(row);

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
          {isCanceled ? (
            <Badge variant="terminal">中止</Badge>
          ) : row.isPostFinalRetainedHistory ? (
            <Badge variant="terminal">受付終了</Badge>
          ) : null}
          {row.myState !== null ? (
            <Badge variant={ticketOpportunityStateBadgeVariant(row.myState)}>
              {ticketOpportunityStateLabel(row.myState)}
            </Badge>
          ) : null}
          {deadlineBadge !== null ? (
            <Badge variant={deadlineBadge.variant}>{deadlineBadge.label}</Badge>
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
        {row.isFirstRowForOpportunity && !row.isPostFinalRetainedHistory ? (
          <TicketOpportunityStateControls opportunityId={row.opportunityId} myState={row.myState} />
        ) : null}
      </div>
    </li>
  );
}
