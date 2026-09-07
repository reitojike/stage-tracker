import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { listTicketOpportunitiesWithDetails } from '@/infrastructure/supabase/ticketOpportunity.ts';
import { getEventsByIds, getOccurrencesByIds } from '@/infrastructure/supabase/eventCatalogRead.ts';
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
  selectTicketOpportunityPrimaryRows,
} from '@/domain/ticketOpportunityTimeline.ts';
import type { PlanningError } from '@/domain/planningError.ts';
import { currentInstant, currentTokyoDate } from './_lib/today.ts';
import { TicketOpportunityTimeline } from './_components/TicketOpportunityTimeline.tsx';

const AUTH_FAILURE_PANEL: Record<
  'unauthenticated' | 'failure',
  { title: string; description: string }
> = {
  unauthenticated: {
    title: 'ログインが必要です',
    description: 'セッションの有効期限が切れている可能性があります。再度ログインしてください。',
  },
  failure: {
    title: 'チケットスケジュールを読み込めませんでした',
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

/** Same "failure" wording authOrReadErrorPanel uses for a PlanningError - for
 * the Event Catalog composition reads below, which report a bare
 * EventCatalogReadError (no `kind` to branch on), not a PlanningError. */
function readFailurePanel() {
  return (
    <StatePanel
      variant="error"
      title={AUTH_FAILURE_PANEL.failure.title}
      description={AUTH_FAILURE_PANEL.failure.description}
    />
  );
}

/**
 * /tickets (Issue #144, forward-looking primary view since Issue #175): a
 * per-Opportunity "what's next" surface, plus the caller's own lightweight
 * "申し込む予定 / 申し込み済み" planning state per Opportunity. Canonical read
 * source is #162's typed boundary (listTicketOpportunitiesWithDetails) -
 * Event title/venue and target Occurrence date/time are composed in from the
 * existing Event Catalog typed read boundary (getEventsByIds/
 * getOccurrencesByIds), the same composition style src/app/calendar/page.tsx
 * already established. This page consumes only the TicketOpportunity typed
 * boundary and adds no Opportunity-creation affordance of its own
 * (product-rules.md "Shared / personal authority boundary").
 *
 * #144's own buildTicketOpportunityTimelineRows still flattens every
 * Opportunity's every milestone into one chronological row list unchanged
 * (Home's deadline projection, domain/homeDeadlines.ts, still consumes that
 * full list) - selectTicketOpportunityPrimaryRows (domain/
 * ticketOpportunityTimeline.ts) is the #175 projection on top of it that
 * this page alone applies: at most one (current-or-next, non-past) row per
 * Opportunity, before month-grouping.
 *
 * Auth/read failures are surfaced as a distinct `error` StatePanel, never
 * silently collapsed into the same "no data" empty state a genuinely empty
 * schedule would show (docs/ux-ui.md "Common states").
 */
export default async function TicketsPage() {
  const now = currentInstant();
  const today = currentTokyoDate(now);
  const client = await createSupabaseServerClient();

  const opportunitiesResult = await listTicketOpportunitiesWithDetails(client);
  if (!opportunitiesResult.ok) {
    return (
      <>
        <PageHeading>チケット</PageHeading>
        {authOrReadErrorPanel(opportunitiesResult.error)}
      </>
    );
  }
  const details = opportunitiesResult.data;

  const eventIds = [...new Set(details.map((detail) => detail.opportunity.eventId))];
  const occurrenceIds = [...new Set(details.flatMap((detail) => detail.targetOccurrenceIds))];

  const [eventsResult, occurrencesResult] = await Promise.all([
    eventIds.length === 0
      ? Promise.resolve({ ok: true as const, data: [] })
      : getEventsByIds(client, eventIds),
    occurrenceIds.length === 0
      ? Promise.resolve({ ok: true as const, data: [] })
      : getOccurrencesByIds(client, occurrenceIds),
  ]);
  if (!eventsResult.ok || !occurrencesResult.ok) {
    return (
      <>
        <PageHeading>チケット</PageHeading>
        {readFailurePanel()}
      </>
    );
  }

  const eventsById = new Map(eventsResult.data.map((event) => [event.id, event] as const));
  const occurrencesById = new Map(
    occurrencesResult.data.map((occurrence) => [occurrence.id, occurrence] as const),
  );

  const rows = buildTicketOpportunityTimelineRows(details, eventsById, occurrencesById);
  const primaryRows = selectTicketOpportunityPrimaryRows(rows, now, today);
  const monthGroups = groupTicketOpportunityTimelineRowsByMonth(primaryRows);

  return (
    <>
      <PageHeading>チケット</PageHeading>
      {primaryRows.length === 0 ? (
        <StatePanel variant="empty" title="現在表示できる抽選・販売スケジュールはありません" />
      ) : (
        <TicketOpportunityTimeline monthGroups={monthGroups} todayTokyoDate={today} />
      )}
    </>
  );
}
