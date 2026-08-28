import { ticketOpportunityTimelineMonthHeadingLabel } from '@/domain/ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineMonthGroup } from '@/domain/ticketOpportunityTimeline.ts';
import { TicketOpportunityRow } from './TicketOpportunityRow.tsx';
import styles from './TicketOpportunityTimeline.module.css';

export interface TicketOpportunityTimelineProps {
  monthGroups: readonly TicketOpportunityTimelineMonthGroup[];
  todayTokyoDate: string;
}

/**
 * The flattened, chronologically-ascending Ticket Opportunity milestone
 * timeline (Issue #144 Task Contract): milestones interleave across
 * Opportunities and Events, grouped only by month - never by milestone type.
 */
export function TicketOpportunityTimeline({
  monthGroups,
  todayTokyoDate,
}: TicketOpportunityTimelineProps) {
  return (
    <div className={styles.timeline}>
      {monthGroups.map((group) => (
        <section
          key={group.monthKey}
          aria-label={ticketOpportunityTimelineMonthHeadingLabel(group.monthKey)}
        >
          <h2 className={styles.monthHeading}>
            {ticketOpportunityTimelineMonthHeadingLabel(group.monthKey)}
          </h2>
          <ul className={styles.rowList}>
            {group.rows.map((row) => (
              <TicketOpportunityRow key={row.id} row={row} todayTokyoDate={todayTokyoDate} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
