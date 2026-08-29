import type { ReactNode } from 'react';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import { listTicketOpportunitiesWithDetails } from '@/infrastructure/supabase/ticketOpportunity.ts';
import { listMyParticipations } from '@/infrastructure/supabase/participation.ts';
import { listVisiblePersonalSchedule } from '@/infrastructure/supabase/personalSchedule.ts';
import {
  getEventsByIds,
  getOccurrencesByIds,
  type EventCatalogQueryClient,
} from '@/infrastructure/supabase/eventCatalogRead.ts';
import { buildTicketOpportunityTimelineRows } from '@/domain/ticketOpportunityTimeline.ts';
import { selectHomeDeadlineRows } from '@/domain/homeDeadlines.ts';
import { groupOccurrencesByEvent } from '@/domain/eventCatalog.ts';
import { buildMyCalendarOccurrenceEntries } from '@/domain/myCalendar.ts';
import { groupHomeUpcomingItemsByDate, selectHomeUpcomingItems } from '@/domain/homeUpcoming.ts';
import type { PlanningError } from '@/domain/planningError.ts';
import type {
  EventCatalogEvent,
  EventCatalogReadResult,
  EventOccurrence,
} from '@/domain/eventCatalog.ts';
import { currentInstant, currentTokyoDate } from './_lib/now.ts';
import { HomeDeadlineList } from './_components/HomeDeadlineList.tsx';
import { HomeUpcomingList } from './_components/HomeUpcomingList.tsx';
import styles from './page.module.css';

const AUTH_FAILURE_PANEL: Record<
  'unauthenticated' | 'failure',
  { title: string; description: string }
> = {
  unauthenticated: {
    title: 'ログインが必要です',
    description: 'セッションの有効期限が切れている可能性があります。再度ログインしてください。',
  },
  failure: {
    title: 'ホームを読み込めませんでした',
    description: '通信状況を確認し、もう一度お試しください。',
  },
};

function authOrReadErrorPanel(error: PlanningError) {
  const key = error.kind === 'unauthenticated' ? 'unauthenticated' : 'failure';
  return (
    <StatePanel
      variant="error"
      title={AUTH_FAILURE_PANEL[key].title}
      description={AUTH_FAILURE_PANEL[key].description}
    />
  );
}

/**
 * Block B's own two-hop chain (participation occurrence ids -> their
 * Occurrences -> those Occurrences' Events), isolated into its own function
 * so it can run as one independent promise alongside Block A's unrelated
 * getEventsByIds(opportunityEventIds) call, rather than both being forced
 * through a single shared Promise.all (which would make this chain's start
 * wait on Block A's fetch even though nothing here depends on it).
 */
async function resolveParticipationEventsAndOccurrences(
  client: EventCatalogQueryClient,
  participationOccurrenceIds: readonly string[],
): Promise<{
  occurrencesResult: EventCatalogReadResult<EventOccurrence[]>;
  eventsResult: EventCatalogReadResult<EventCatalogEvent[]>;
}> {
  const occurrencesResult: EventCatalogReadResult<EventOccurrence[]> =
    participationOccurrenceIds.length === 0
      ? { ok: true, data: [] }
      : await getOccurrencesByIds(client, participationOccurrenceIds);
  if (!occurrencesResult.ok) {
    return { occurrencesResult, eventsResult: occurrencesResult };
  }
  const eventIds = [...new Set(occurrencesResult.data.map((occurrence) => occurrence.eventId))];
  const eventsResult: EventCatalogReadResult<EventCatalogEvent[]> =
    eventIds.length === 0 ? { ok: true, data: [] } : await getEventsByIds(client, eventIds);
  return { occurrencesResult, eventsResult };
}

/**
 * Home (Issue #143): a dashboard of exactly two independent blocks -
 * "申し込み期限" (deadline) and "直近の予定" (upcoming) - replacing the prior
 * generic navigation-hub surface (HomeNav, removed by this Task). Account /
 * sign-out / Passkey stay on My Page, reached from the AppBar avatar
 * (Issue #159) - this page does not reintroduce them.
 *
 * Canonical sources, matching #144's/My Calendar's own typed read boundary
 * exactly (never a raw table query, never the legacy ticket_acquisitions
 * boundary):
 * - Block A: listTicketOpportunitiesWithDetails + getEventsByIds, filtered/
 *   ordered by domain/homeDeadlines.ts's selectHomeDeadlineRows (which
 *   reuses #144's own isActionableTicketOpportunityDeadline - "planned" +
 *   future/today "application_close" only - bounded to HOME_WINDOW_DAYS by
 *   Issue #192, no count cap within that window).
 * - Block B: listMyParticipations + listVisiblePersonalSchedule, composed
 *   with getOccurrencesByIds/getEventsByIds, projected by
 *   domain/homeUpcoming.ts's selectHomeUpcomingItems (nearest-first, bounded
 *   to HOME_WINDOW_DAYS and capped at HOME_UPCOMING_LIMIT, with a single
 *   nearest-outside-window fallback item when the window itself is empty -
 *   Issue #192 bounded supersede of this Task's original max-8/unbounded
 *   projection).
 *
 * The four independent reads (identity, Opportunities, participations,
 * personal schedule) start together via Promise.all. Past that point, Block
 * A's own getEventsByIds/getOccurrencesByIds(opportunityEventIds/
 * opportunityOccurrenceIds) calls and Block B's own
 * resolveParticipationEventsAndOccurrences (its occurrences-then-their-events
 * two-hop chain) run as separate promises in one more Promise.all, rather
 * than Block B's chain being nested *inside* a shared await that would
 * otherwise make its own second hop wait on Block A's unrelated fetches to
 * finish first. Block A resolves its own Occurrences (not an empty Map) so
 * the Issue #172 cancellation-aggregation rule can see each
 * selected_occurrences target's own canceledAt, matching /tickets'
 * (src/app/tickets/page.tsx) own composition. Each block's own StatePanel
 * then depends only on
 * that block's own reads, so a read failure partway through one block's
 * chain never blocks the other from rendering - unlike /tickets and
 * /calendar (src/app/tickets/page.tsx, src/app/calendar/page.tsx), which
 * both still abort the *entire* page to one full-page error panel on any
 * data-read failure; only a genuine identity/auth failure does that here.
 */
export default async function Home() {
  const today = currentTokyoDate();
  const now = currentInstant();
  const client = await createSupabaseServerClient();

  const [callerResult, opportunitiesResult, participationsResult, scheduleResult] =
    await Promise.all([
      requireAuthenticatedUserId(client),
      listTicketOpportunitiesWithDetails(client),
      listMyParticipations(client),
      listVisiblePersonalSchedule(client),
    ]);

  if (!callerResult.ok) {
    return (
      <>
        <PageHeading>ホーム</PageHeading>
        {authOrReadErrorPanel(callerResult.error)}
      </>
    );
  }
  const callerId = callerResult.data;

  const opportunityEventIds = opportunitiesResult.ok
    ? [...new Set(opportunitiesResult.data.map((detail) => detail.opportunity.eventId))]
    : [];
  // A selected_occurrences Opportunity's targets must be resolved here too
  // (not left as an empty Map) - the Issue #172 cancellation-aggregation
  // rule needs each target Occurrence's own canceledAt to tell "all targets
  // canceled" from "some/none canceled", and an unresolved (always-empty)
  // target set would otherwise silently read as "never canceled" for every
  // selected_occurrences Opportunity Home shows.
  const opportunityOccurrenceIds = opportunitiesResult.ok
    ? [...new Set(opportunitiesResult.data.flatMap((detail) => detail.targetOccurrenceIds))]
    : [];
  const participationOccurrenceIds = participationsResult.ok
    ? [...new Set(participationsResult.data.map((participation) => participation.occurrenceId))]
    : [];

  const [opportunityEventsResult, opportunityOccurrencesResult, participationEventsAndOccurrences] =
    await Promise.all([
      opportunityEventIds.length === 0
        ? Promise.resolve({ ok: true as const, data: [] })
        : getEventsByIds(client, opportunityEventIds),
      opportunityOccurrenceIds.length === 0
        ? Promise.resolve({ ok: true as const, data: [] })
        : getOccurrencesByIds(client, opportunityOccurrenceIds),
      resolveParticipationEventsAndOccurrences(client, participationOccurrenceIds),
    ]);
  const {
    occurrencesResult: participationOccurrencesResult,
    eventsResult: participationEventsResult,
  } = participationEventsAndOccurrences;

  // --- Block A: 申し込み期限 ---
  let deadlineBlock: ReactNode;
  if (!opportunitiesResult.ok || !opportunityEventsResult.ok || !opportunityOccurrencesResult.ok) {
    deadlineBlock = (
      <StatePanel
        variant="unavailable"
        title="申し込み期限を読み込めませんでした"
        description="通信状況を確認し、もう一度お試しください。"
      />
    );
  } else {
    const eventsById = new Map(
      opportunityEventsResult.data.map((event) => [event.id, event] as const),
    );
    const occurrencesById = new Map(
      opportunityOccurrencesResult.data.map((occurrence) => [occurrence.id, occurrence] as const),
    );
    const timelineRows = buildTicketOpportunityTimelineRows(
      opportunitiesResult.data,
      eventsById,
      occurrencesById,
    );
    const deadlineRows = selectHomeDeadlineRows(timelineRows, today);
    deadlineBlock =
      deadlineRows.length === 0 ? (
        <StatePanel variant="empty" title="現在、申し込み予定の締切はありません" />
      ) : (
        <HomeDeadlineList rows={deadlineRows} todayTokyoDate={today} />
      );
  }

  // --- Block B: 直近の予定 ---
  let upcomingBlock: ReactNode;
  if (
    !participationsResult.ok ||
    !scheduleResult.ok ||
    !participationOccurrencesResult.ok ||
    !participationEventsResult.ok
  ) {
    upcomingBlock = (
      <StatePanel
        variant="unavailable"
        title="直近の予定を読み込めませんでした"
        description="通信状況を確認し、もう一度お試しください。"
      />
    );
  } else {
    // Reuses the same Event+Occurrence+Participation join My Calendar
    // already established (src/app/calendar/page.tsx), rather than
    // re-deriving an equivalent one - the empty acquisitions map means
    // every entry's ticketStatus resolves to 'none', which Home simply
    // never reads (Home's Task Contract keeps the legacy ticket_acquisitions
    // model out of this projection entirely).
    const eventsWithOccurrences = groupOccurrencesByEvent(
      participationEventsResult.data,
      participationOccurrencesResult.data,
    );
    const participationsByOccurrenceId = new Map(
      participationsResult.data.map(
        (participation) => [participation.occurrenceId, participation] as const,
      ),
    );
    const occurrenceCandidates = buildMyCalendarOccurrenceEntries(
      eventsWithOccurrences,
      participationsByOccurrenceId,
      new Map(),
    );
    const scheduleCandidates = scheduleResult.data.map((entry) => ({
      entry,
      isOwner: entry.ownerId === callerId,
    }));

    const items = selectHomeUpcomingItems(occurrenceCandidates, scheduleCandidates, now, today);
    const dateGroups = groupHomeUpcomingItemsByDate(items);
    upcomingBlock =
      items.length === 0 ? (
        <StatePanel variant="empty" title="直近の予定はありません" />
      ) : (
        <HomeUpcomingList dateGroups={dateGroups} />
      );
  }

  return (
    <>
      <PageHeading>ホーム</PageHeading>
      <div className={styles.blocks}>
        <section aria-labelledby="home-deadline-heading" className={styles.block}>
          <h2 id="home-deadline-heading" className={styles.blockHeading}>
            申し込み期限
          </h2>
          {deadlineBlock}
        </section>
        <section aria-labelledby="home-upcoming-heading" className={styles.block}>
          <h2 id="home-upcoming-heading" className={styles.blockHeading}>
            直近の予定
          </h2>
          {upcomingBlock}
        </section>
      </div>
    </>
  );
}
