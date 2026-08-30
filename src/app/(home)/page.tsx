import type { ReactNode } from 'react';
import Link from 'next/link';
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

/** Each block owns an independent read outcome. `'unavailable'` (read failed)
 * and `'empty'` (read succeeded, nothing to show) stay distinct so a failed
 * read cannot masquerade as an empty result. `data` holds the already-built
 * populated ReactNode, allowing both blocks to use the same outcome-to-panel
 * mapping regardless of their different data shapes. */
type HomeBlockOutcome =
  { status: 'unavailable' } | { status: 'empty' } | { status: 'populated'; data: ReactNode };

/** Maps a block outcome to its panel. An unavailable result always keeps its
 * own failure panel; an empty result uses its block-specific title unless the
 * combined empty state is being rendered after both sections; populated data
 * is rendered as already composed. */
function renderHomeBlockPanel(
  outcome: HomeBlockOutcome,
  unavailableTitle: string,
  emptyTitle: string,
  bothEmpty: boolean,
): ReactNode {
  if (outcome.status === 'unavailable') {
    return (
      <StatePanel
        variant="unavailable"
        title={unavailableTitle}
        description="通信状況を確認し、もう一度お試しください。"
      />
    );
  }
  if (outcome.status === 'empty') {
    return bothEmpty ? null : <StatePanel variant="empty" title={emptyTitle} />;
  }
  return outcome.data;
}

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

/** Resolves the upcoming block's two-hop Event Catalog read (participation
 * occurrence ids -> their Occurrences -> those Occurrences' Events). The
 * chain is kept independent from the deadline block's unrelated Event read so
 * each block can make progress and report its own failure. */
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
 * Home composes exactly two independent planning blocks: "申し込み期限"
 * (deadline) and "直近の予定" (upcoming). The page owns read and composition
 * orchestration; the domain projections own each block's filtering, temporal
 * window, ordering, and display limit rules.
 *
 * All sources arrive through typed infrastructure reads rather than raw table
 * queries:
 * - Block A reads TicketOpportunity details and their Event/Occurrence data,
 *   then delegates deadline selection to `selectHomeDeadlineRows`.
 * - Block B reads registered participations and visible personal schedules,
 *   resolves the participation Event/Occurrence join, then delegates the
 *   mixed upcoming projection to `selectHomeUpcomingItems`.
 *
 * Identity, opportunities, participations, and personal schedule start
 * together. Their follow-up reads then run as independent block-owned
 * promises. Block A resolves target Occurrences so its cancellation
 * aggregation can inspect each selected target's own `canceledAt`. Each
 * block's panel depends only on that block's reads, so a partial failure in one
 * chain does not prevent the other block from rendering; identity/auth failure
 * remains the only page-wide failure. */
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
  // Resolve selected_occurrences targets before timeline projection so
  // cancellation aggregation can inspect each target Occurrence's own
  // `canceledAt`; an empty lookup would incorrectly make every target appear
  // active.
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
  let deadlineOutcome: HomeBlockOutcome;
  if (!opportunitiesResult.ok || !opportunityEventsResult.ok || !opportunityOccurrencesResult.ok) {
    deadlineOutcome = { status: 'unavailable' };
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
    deadlineOutcome =
      deadlineRows.length === 0
        ? { status: 'empty' }
        : {
            status: 'populated',
            data: <HomeDeadlineList rows={deadlineRows} todayTokyoDate={today} />,
          };
  }

  // --- Block B: 直近の予定 ---
  let upcomingOutcome: HomeBlockOutcome;
  if (
    !participationsResult.ok ||
    !scheduleResult.ok ||
    !participationOccurrencesResult.ok ||
    !participationEventsResult.ok
  ) {
    upcomingOutcome = { status: 'unavailable' };
  } else {
    // Reuse My Calendar's Event+Occurrence+Participation entry shape so both
    // surfaces interpret registered occurrences through the same domain
    // boundary. The upcoming block composes only participation and visible
    // personal-schedule data; TicketOpportunity data belongs to the deadline
    // block.
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
    );
    const scheduleCandidates = scheduleResult.data.map((entry) => ({
      entry,
      isOwner: entry.ownerId === callerId,
    }));

    const items = selectHomeUpcomingItems(occurrenceCandidates, scheduleCandidates, now, today);
    const dateGroups = groupHomeUpcomingItemsByDate(items);
    upcomingOutcome =
      dateGroups.length === 0
        ? { status: 'empty' }
        : { status: 'populated', data: <HomeUpcomingList dateGroups={dateGroups} /> };
  }

  // Only two successful empty projections share the combined empty guidance.
  // An unavailable block remains visible through its own panel and is never
  // folded into the empty state.
  const bothEmpty = deadlineOutcome.status === 'empty' && upcomingOutcome.status === 'empty';

  const deadlineBlock = renderHomeBlockPanel(
    deadlineOutcome,
    '申し込み期限を読み込めませんでした',
    '期限が近いものはありません',
    bothEmpty,
  );
  const upcomingBlock = renderHomeBlockPanel(
    upcomingOutcome,
    '直近の予定を読み込めませんでした',
    '予定はありません',
    bothEmpty,
  );

  return (
    <>
      <PageHeading>ホーム</PageHeading>
      <div className={styles.blocks}>
        <section aria-labelledby="home-deadline-heading" className={styles.block}>
          <div className={styles.deadlineHeadingRow}>
            <h2 id="home-deadline-heading" className={styles.deadlineHeadingText}>
              申し込み期限
            </h2>
            <Link href="/tickets" className={styles.deadlineAllLink}>
              すべて見る ›
            </Link>
          </div>
          {deadlineBlock}
        </section>
        <section aria-labelledby="home-upcoming-heading" className={styles.block}>
          <h2 id="home-upcoming-heading" className={styles.blockHeading}>
            直近の予定
          </h2>
          {upcomingBlock}
        </section>
        {bothEmpty ? (
          <StatePanel variant="empty" title="期限が近い申し込みも、直近の予定もありません" />
        ) : null}
      </div>
    </>
  );
}
