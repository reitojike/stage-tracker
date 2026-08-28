import type { ReactNode } from 'react';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import { listTicketOpportunitiesWithDetails } from '@/infrastructure/supabase/ticketOpportunity.ts';
import { listMyParticipations } from '@/infrastructure/supabase/participation.ts';
import { listVisiblePersonalSchedule } from '@/infrastructure/supabase/personalSchedule.ts';
import { getEventsByIds, getOccurrencesByIds } from '@/infrastructure/supabase/eventCatalogRead.ts';
import { buildTicketOpportunityTimelineRows } from '@/domain/ticketOpportunityTimeline.ts';
import { selectHomeDeadlineRows } from '@/domain/homeDeadlines.ts';
import {
  groupHomeUpcomingItemsByDate,
  selectHomeUpcomingItems,
  type HomeUpcomingOccurrenceCandidate,
} from '@/domain/homeUpcoming.ts';
import type { PlanningError } from '@/domain/planningError.ts';
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
 *   future/today "application_close" only).
 * - Block B: listMyParticipations + listVisiblePersonalSchedule, composed
 *   with getOccurrencesByIds/getEventsByIds, projected by
 *   domain/homeUpcoming.ts's selectHomeUpcomingItems (nearest-first, capped
 *   at 8).
 *
 * The four independent reads (identity, Opportunities, participations,
 * personal schedule) start together via Promise.all, and each block then
 * resolves its own Event/Occurrence lookups independently (a second
 * Promise.all) so a read failure in one block's dependency never takes the
 * other block down with it - only a genuine identity/auth failure blocks
 * the whole page, the same "auth failure is page-level, a data-read failure
 * degrades only its own section" split /tickets and /calendar already use.
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
  const participationOccurrenceIds = participationsResult.ok
    ? [...new Set(participationsResult.data.map((participation) => participation.occurrenceId))]
    : [];

  const [opportunityEventsResult, participationOccurrencesResult] = await Promise.all([
    opportunityEventIds.length === 0
      ? Promise.resolve({ ok: true as const, data: [] })
      : getEventsByIds(client, opportunityEventIds),
    participationOccurrenceIds.length === 0
      ? Promise.resolve({ ok: true as const, data: [] })
      : getOccurrencesByIds(client, participationOccurrenceIds),
  ]);

  const participationEventIds = participationOccurrencesResult.ok
    ? [...new Set(participationOccurrencesResult.data.map((occurrence) => occurrence.eventId))]
    : [];
  const participationEventsResult =
    participationEventIds.length === 0
      ? { ok: true as const, data: [] }
      : await getEventsByIds(client, participationEventIds);

  // --- Block A: 申し込み期限 ---
  let deadlineBlock: ReactNode;
  if (!opportunitiesResult.ok || !opportunityEventsResult.ok) {
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
    const timelineRows = buildTicketOpportunityTimelineRows(
      opportunitiesResult.data,
      eventsById,
      new Map(),
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
    const eventsById = new Map(
      participationEventsResult.data.map((event) => [event.id, event] as const),
    );
    const occurrencesById = new Map(
      participationOccurrencesResult.data.map((occurrence) => [occurrence.id, occurrence] as const),
    );
    const occurrenceCandidates: HomeUpcomingOccurrenceCandidate[] =
      participationsResult.data.flatMap((participation) => {
        const occurrence = occurrencesById.get(participation.occurrenceId);
        if (occurrence === undefined) {
          return [];
        }
        const event = eventsById.get(occurrence.eventId);
        if (event === undefined) {
          return [];
        }
        return [{ event, occurrence, participation }];
      });
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
