import Link from 'next/link';
import { Badge } from '@/ui/Badge';
import type { MyCalendarEntry } from '@/domain/myCalendar.ts';
import { isEffectivelyCanceled } from '@/domain/eventCancellation.ts';
import { occurrenceTimeRangeLabel } from '@/domain/catalogFormatting.ts';
import { catalogEventHref, type CatalogParams } from '@/domain/catalogNavigation.ts';
import {
  myCalendarScheduleTemporalLabel,
  participationStatusLabel,
  ticketDisplayStatusBadgeVariant,
  ticketDisplayStatusLabel,
} from '@/domain/myCalendarFormatting.ts';
import styles from './MySelectedDayList.module.css';

export interface MyCalendarEntryRowProps {
  item: MyCalendarEntry;
  /** The shared Event Catalog context for an occurrence link. The month
   * agenda supplies its group date here; the selected-day list supplies its
   * selected date, so both use the same exact-occurrence navigation helper. */
  eventDetailContext: CatalogParams;
}

/**
 * Shared My Calendar row presenter for the selected-day detail and month
 * landing agenda. Keeping the complete row here prevents the two surfaces
 * from drifting on participation/ticket/cancellation badges, schedule
 * ownership/blocking badges, links, or temporal precision.
 */
export function MyCalendarEntryRow({ item, eventDetailContext }: MyCalendarEntryRowProps) {
  if (item.kind === 'occurrence') {
    const { event, occurrence, participation, ticketStatus } = item.occurrenceEntry;
    return (
      <Link
        href={catalogEventHref(event.id, eventDetailContext, occurrence.id)}
        className={styles.itemLink}
      >
        <span className={styles.itemBody}>
          <span className={styles.time}>
            {occurrenceTimeRangeLabel(occurrence.startsAt, occurrence.endsAt)}
          </span>
          <span className={styles.title}>{event.title}</span>
          {event.venue !== null ? <span className={styles.venue}>{event.venue}</span> : null}
          <span className={styles.badgeRow}>
            <Badge variant="subtle">{participationStatusLabel(participation.status)}</Badge>
            <Badge variant={ticketDisplayStatusBadgeVariant(ticketStatus)}>
              {ticketDisplayStatusLabel(ticketStatus)}
            </Badge>
            {isEffectivelyCanceled(event, occurrence) ? (
              <Badge variant="terminal">中止</Badge>
            ) : null}
          </span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </Link>
    );
  }

  const { entry, isOwner } = item.scheduleEntry;
  return (
    <Link href={`/schedule/${entry.id}`} className={styles.itemLink}>
      <span className={styles.itemBody}>
        <span className={styles.badgeRow}>
          <Badge variant="subtle">{isOwner ? '自分の予定' : '共有されている予定'}</Badge>
          {!entry.blocking ? <Badge variant="outline">予定を確保しない</Badge> : null}
        </span>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.time}>{myCalendarScheduleTemporalLabel(entry.temporal)}</span>
        {entry.memo !== null && entry.memo.length > 0 ? (
          <span className={styles.venue}>{entry.memo}</span>
        ) : null}
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
