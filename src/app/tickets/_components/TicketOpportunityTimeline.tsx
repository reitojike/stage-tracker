import { ticketOpportunityTimelineMonthHeadingLabel } from '@/domain/ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineMonthGroup } from '@/domain/ticketOpportunityTimeline.ts';
import { TicketOpportunityRow } from './TicketOpportunityRow.tsx';
import styles from './TicketOpportunityTimeline.module.css';

export interface TicketOpportunityTimelineProps {
  monthGroups: readonly TicketOpportunityTimelineMonthGroup[];
  todayTokyoDate: string;
}

/**
 * The forward-looking Ticket Opportunity primary view (Issue #175): at most
 * one (current-or-next) row per Opportunity, chronologically ascending and
 * interleaved across Opportunities/Events, grouped only by month - never by
 * milestone type. `monthGroups` is expected to already be built from
 * selectTicketOpportunityPrimaryRows's output (domain/
 * ticketOpportunityTimeline.ts), not the raw #144 flattened timeline.
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
