import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTicketOpportunityTimelineRows,
  compareInstants,
  isInstantSameOrAfter,
  selectTicketOpportunityPrimaryRows,
  tokyoCalendarDayRangeUtc,
  type Event,
  type Instant,
  type Occurrence,
  type Participation,
  type PersonalScheduleEntry,
  type TicketOpportunityTimelineRow,
  type UserId,
} from "@stage-tracker/domain";
import {
  buildTicketOpportunityAggregates,
  listMyParticipations,
  listMyTicketOpportunityStates,
  listTicketOpportunities,
  listVisiblePersonalSchedule,
  type ParticipationWithOccurrence,
} from "@/lib/data";
import { classifyBlock2, type BlockState } from "@/app/_lib/read-state";
import type { ScreenNow } from "@/app/_lib/now";

/**
 * `/` home's data layer (`docs/v2/oracle-routes-ui.md` §1 `/`, §2 「ホーム」).
 *
 * The oracle's core invariant for this screen (`docs/v2/decisions.md` P4):
 * "申し込み期限" and "直近の予定" are 2 **completely independent** blocks,
 * each with its own `empty`/`error`/`unavailable`/`populated` classification.
 * A failure in one must never hide or degrade the other - this is why each
 * block below is its own exported function returning its own `BlockState`,
 * rather than one function returning a single combined page state.
 */

const HOME_TICKET_DEADLINE_LIMIT = 5;
const HOME_UPCOMING_SCHEDULE_LIMIT = 5;

export interface HomeTicketDeadlineRow {
  readonly row: TicketOpportunityTimelineRow;
}

/**
 * "申し込み期限" block: `listTicketOpportunities` (shared catalog) +
 * `listMyTicketOpportunityStates` (personal planning state), reduced to the
 * chronologically-nearest still-relevant milestone per Opportunity
 * (`@stage-tracker/domain`'s `selectTicketOpportunityPrimaryRows`), excluding
 * post-final retained history (that belongs to `/tickets`'s full timeline,
 * not home's "upcoming deadlines" framing - AGENT decision, not specified by
 * the oracle at this granularity) and capped to
 * `HOME_TICKET_DEADLINE_LIMIT` rows (also an AGENT decision - the oracle
 * does not specify a home-page row limit; see this Task's report).
 */
export async function loadHomeTicketDeadlines(
  supabase: SupabaseClient,
  userId: UserId,
  now: ScreenNow,
): Promise<BlockState<readonly HomeTicketDeadlineRow[]>> {
  const [opportunitiesResult, statesResult] = await Promise.all([
    listTicketOpportunities(supabase),
    listMyTicketOpportunityStates(supabase, userId),
  ]);

  return classifyBlock2(
    opportunitiesResult,
    statesResult,
    (opportunities, states) => {
      const aggregates = buildTicketOpportunityAggregates(
        opportunities,
        states,
      );
      const timelineRows = buildTicketOpportunityTimelineRows(aggregates);
      const primaryRows = selectTicketOpportunityPrimaryRows(
        timelineRows,
        now.nowInstant,
        now.todayTokyoDate,
      );
      return primaryRows
        .filter((row) => !row.isPostFinalRetainedHistory)
        .slice(0, HOME_TICKET_DEADLINE_LIMIT)
        .map((row) => ({ row }));
    },
    (data) => data.length === 0,
  );
}

export type HomeUpcomingItem =
  | {
      readonly kind: "occurrence";
      readonly sortInstant: Instant;
      readonly participation: Participation;
      readonly occurrence: Occurrence;
      readonly event: Event;
    }
  | {
      readonly kind: "schedule";
      readonly sortInstant: Instant;
      readonly entry: PersonalScheduleEntry;
    };

function isUpcomingParticipation(
  entry: ParticipationWithOccurrence,
  now: ScreenNow,
): boolean {
  return isInstantSameOrAfter(entry.occurrence.startsAt, now.nowInstant);
}

function scheduleEntrySortInstant(entry: PersonalScheduleEntry): Instant {
  return entry.temporal.kind === "all-day"
    ? tokyoCalendarDayRangeUtc(entry.temporal.startsOn).startInstant
    : entry.temporal.startsAt;
}

function isUpcomingScheduleEntry(
  entry: PersonalScheduleEntry,
  now: ScreenNow,
): boolean {
  if (entry.temporal.kind === "all-day") {
    return (
      tokyoCalendarDayRangeUtc(entry.temporal.endsOn).endInstantExclusive >
      now.nowInstant
    );
  }
  const relevantEnd = entry.temporal.endsAt ?? entry.temporal.startsAt;
  return isInstantSameOrAfter(relevantEnd, now.nowInstant);
}

function compareUpcomingItems(
  a: HomeUpcomingItem,
  b: HomeUpcomingItem,
): number {
  return compareInstants(a.sortInstant, b.sortInstant);
}

/**
 * "直近の予定" block: `listMyParticipations` + `listVisiblePersonalSchedule`,
 * merged into one chronological list of not-yet-past items (an occurrence
 * the caller has a Participation for, or a personal schedule entry visible
 * to the caller), capped to `HOME_UPCOMING_SCHEDULE_LIMIT` rows (AGENT
 * decision, see `loadHomeTicketDeadlines`'s docstring for the same kind of
 * decision on the other block).
 */
export async function loadHomeUpcomingSchedule(
  supabase: SupabaseClient,
  userId: UserId,
  now: ScreenNow,
): Promise<BlockState<readonly HomeUpcomingItem[]>> {
  const [participationsResult, scheduleResult] = await Promise.all([
    listMyParticipations(supabase, userId),
    listVisiblePersonalSchedule(supabase),
  ]);

  return classifyBlock2(
    participationsResult,
    scheduleResult,
    (participations, scheduleEntries) => {
      const occurrenceItems: HomeUpcomingItem[] = participations
        .filter((entry) => isUpcomingParticipation(entry, now))
        .map((entry) => ({
          kind: "occurrence",
          sortInstant: entry.occurrence.startsAt,
          participation: entry.participation,
          occurrence: entry.occurrence,
          event: entry.event,
        }));

      const scheduleItems: HomeUpcomingItem[] = scheduleEntries
        .filter((entry) => isUpcomingScheduleEntry(entry, now))
        .map((entry) => ({
          kind: "schedule",
          sortInstant: scheduleEntrySortInstant(entry),
          entry,
        }));

      return [...occurrenceItems, ...scheduleItems]
        .sort(compareUpcomingItems)
        .slice(0, HOME_UPCOMING_SCHEDULE_LIMIT);
    },
    (data) => data.length === 0,
  );
}
