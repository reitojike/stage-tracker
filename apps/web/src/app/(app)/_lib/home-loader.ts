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
  type TicketOpportunityTargetScope,
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
import {
  classifyBlock2Optional,
  classifyMergedListBlock2,
  type MergedListBlockState,
  type OptionalPartBlockState,
} from "@/app/_lib/read-state";
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
 *
 * P4 also applies *within* each block, at read granularity (PR #381 review
 * finding 1): both blocks below are themselves backed by 2 independent
 * reads, and neither uses a strict "both must succeed" combinator anymore -
 * see `loadHomeTicketDeadlines`'s `classifyBlock2Optional` (shared catalog
 * is required, personal state is optional) and
 * `loadHomeUpcomingSchedule`'s `classifyMergedListBlock2` (both reads are
 * independent list contributors) for how each block's specific shape
 * decides which combinator applies.
 */

const HOME_TICKET_DEADLINE_LIMIT = 5;
const HOME_UPCOMING_SCHEDULE_LIMIT = 5;

export interface HomeTicketDeadlineRow {
  readonly row: TicketOpportunityTimelineRow;
  readonly eventTitle: string;
  readonly isEffectivelyCanceled: boolean;
  readonly targetScope: TicketOpportunityTargetScope;
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
 *
 * `listTicketOpportunities` is the **required** read here and
 * `listMyTicketOpportunityStates` is **optional**
 * (`classifyBlock2Optional`, PR #381 review finding 1): if only the
 * personal-state read fails, `block` still renders every opportunity with
 * `myState: null` per row (identical to a caller with 0 rows in that table -
 * `buildTicketOpportunityAggregates`'s own docstring), rather than hiding
 * the whole block. If the shared catalog read itself fails, there is no
 * opportunity data to show at all, so `block` reports that failure.
 *
 * The returned `optional` field (PR #381 P4 follow-up review finding 2)
 * always reflects `listMyTicketOpportunityStates`'s own real status, so
 * `../_components/HomeView.tsx` can tell "no personal state for any row"
 * apart from "the personal-state read failed" - the 2 cases that collapse to
 * the exact same `block.data` shape (`myState: null` everywhere) and would
 * otherwise be indistinguishable to a screen that only looked at `block`.
 */
export async function loadHomeTicketDeadlines(
  supabase: SupabaseClient,
  userId: UserId,
  now: ScreenNow,
): Promise<OptionalPartBlockState<readonly HomeTicketDeadlineRow[]>> {
  const [opportunitiesResult, statesResult] = await Promise.all([
    listTicketOpportunities(supabase),
    listMyTicketOpportunityStates(supabase, userId),
  ]);

  return classifyBlock2Optional(
    opportunitiesResult,
    statesResult,
    [],
    (opportunities, states) => {
      const aggregates = buildTicketOpportunityAggregates(
        opportunities,
        states,
      );
      const timelineRows = buildTicketOpportunityTimelineRows(aggregates);
      const detailByOpportunityId = new Map(
        opportunities.map(
          (detail) =>
            [detail.opportunityWithTargets.opportunity.id, detail] as const,
        ),
      );
      const primaryRows = selectTicketOpportunityPrimaryRows(
        timelineRows,
        now.nowInstant,
        now.todayTokyoDate,
      );
      return primaryRows
        .filter((row) => !row.isPostFinalRetainedHistory)
        .slice(0, HOME_TICKET_DEADLINE_LIMIT)
        .map((row) => {
          const detail = detailByOpportunityId.get(row.opportunityId);
          if (detail === undefined) {
            throw new Error(
              `unreachable: timeline row has no source opportunity detail (${row.opportunityId})`,
            );
          }
          return {
            row,
            eventTitle: detail.eventTitle,
            isEffectivelyCanceled: detail.isEffectivelyCanceled,
            targetScope: detail.opportunityWithTargets.opportunity.targetScope,
          };
        });
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
      readonly isOwner: boolean;
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
 *
 * Unlike `loadHomeTicketDeadlines`, neither read here is "the backbone" of
 * the other - both independently contribute their own items to the merged
 * list. `classifyMergedListBlock2` (PR #381 review finding 1) therefore
 * degrades per-read: if either `listMyParticipations` or
 * `listVisiblePersonalSchedule` fails alone, this still returns a `"partial"`
 * `MergedListBlockState` built from the surviving read's upcoming items
 * rather than hiding the whole block.
 *
 * `"partial"` is reported instead of `"empty"` even when the surviving
 * read's own items happen to be empty (PR #381 P4 follow-up review finding
 * 1) - `../_components/HomeView.tsx` renders that failed side's own "読み込
 * めませんでした" note next to whatever the surviving side produced, instead
 * of the failure disappearing into the same "直近の予定はありません" panel a
 * caller would see with no failure at all.
 */
export async function loadHomeUpcomingSchedule(
  supabase: SupabaseClient,
  userId: UserId,
  now: ScreenNow,
): Promise<MergedListBlockState<readonly HomeUpcomingItem[]>> {
  const [participationsResult, scheduleResult] = await Promise.all([
    listMyParticipations(supabase, userId),
    listVisiblePersonalSchedule(supabase),
  ]);

  return classifyMergedListBlock2(
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
          isOwner: entry.ownerId === userId,
        }));

      return [...occurrenceItems, ...scheduleItems]
        .sort(compareUpcomingItems)
        .slice(0, HOME_UPCOMING_SCHEDULE_LIMIT);
    },
    (data) => data.length === 0,
  );
}
