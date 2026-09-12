import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  err,
  instantSchema,
  isTicketOpportunityEffectivelyCanceled,
  occurrenceIdSchema,
  ok,
  ticketOpportunityWithTargetsSchema,
  type Instant,
  type OccurrenceId,
  type Occurrence,
  type Result,
  type TicketOpportunityCancellationScope,
  type TicketOpportunityAggregate,
  type TicketOpportunityMilestone,
  type TicketOpportunityWithTargets,
  type UserId,
  type UserTicketOpportunityState,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import {
  mapTicketOpportunityMilestoneRow,
  mapTicketOpportunityRow,
  mapUserTicketOpportunityStateRow,
  type TicketOpportunityMilestoneRow,
  type TicketOpportunityRow,
} from "../mappers/ticketRow";
import { mapOccurrenceRow, type OccurrenceRow } from "../mappers/eventRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

export interface TicketOpportunityListRow extends TicketOpportunityRow {
  readonly events: {
    readonly title: string;
    readonly venue: string | null;
    readonly canceled_at: string | null;
  } | null;
  readonly ticket_opportunity_target_occurrences: readonly {
    readonly occurrence_id: string;
    readonly event_occurrences: OccurrenceRow | null;
  }[];
  readonly ticket_opportunity_milestones: readonly TicketOpportunityMilestoneRow[];
}

export interface TicketOpportunityDetail {
  readonly opportunityWithTargets: TicketOpportunityWithTargets;
  readonly milestones: readonly TicketOpportunityMilestone[];
  readonly cancellationScope: TicketOpportunityCancellationScope;
  readonly isEffectivelyCanceled: boolean;
  readonly eventTitle: string;
  readonly eventVenue: string | null;
  readonly targetOccurrences: readonly Occurrence[];
}

const eventDisplaySchema = z.object({
  title: z.string().min(1),
  venue: z.string().nullable(),
});

function mapNullableCancellationInstant(
  value: string | null,
  context: string,
): Result<Instant | null, string> {
  if (value === null) {
    return ok(null);
  }
  const parsed = instantSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      `Invalid cancellation timestamp (${context}): ${parsed.error.message}`,
    );
  }
  return ok(parsed.data);
}

function mapTicketOpportunityCancellationScope(
  row: TicketOpportunityListRow,
  targetScope: TicketOpportunityWithTargets["opportunity"]["targetScope"],
): Result<TicketOpportunityCancellationScope, string> {
  if (row.events === null) {
    return err(
      `Invalid ticket_opportunities row (id=${row.id}): parent events row missing while reading cancellation.`,
    );
  }

  const eventCanceledAt = mapNullableCancellationInstant(
    row.events.canceled_at,
    `event_id=${row.event_id}`,
  );
  if (!eventCanceledAt.ok) {
    return eventCanceledAt;
  }

  const resolvedTargetOccurrences: {
    readonly canceledAt: Instant | null;
  }[] = [];
  for (const target of row.ticket_opportunity_target_occurrences) {
    // A missing nested occurrence is an unresolved target, not an active
    // occurrence and never evidence that the whole selected set is canceled.
    if (target.event_occurrences === null) {
      continue;
    }
    const canceledAt = mapNullableCancellationInstant(
      target.event_occurrences.canceled_at,
      `opportunity_id=${row.id}, occurrence_id=${target.occurrence_id}`,
    );
    if (!canceledAt.ok) {
      return canceledAt;
    }
    resolvedTargetOccurrences.push({ canceledAt: canceledAt.value });
  }

  return ok({
    eventCanceled: eventCanceledAt.value !== null,
    targetScope,
    resolvedTargetOccurrences,
    targetOccurrenceIdCount: row.ticket_opportunity_target_occurrences.length,
  });
}

function mapTicketOpportunityListRow(
  row: TicketOpportunityListRow,
): Result<TicketOpportunityDetail, string> {
  const opportunityResult = mapTicketOpportunityRow(row);
  if (!opportunityResult.ok) {
    return opportunityResult;
  }

  const targetOccurrenceIds: OccurrenceId[] = [];
  const targetOccurrences: Occurrence[] = [];
  for (const target of row.ticket_opportunity_target_occurrences) {
    const parsed = occurrenceIdSchema.safeParse(target.occurrence_id);
    if (!parsed.success) {
      return err(
        `Invalid ticket_opportunity_target_occurrences row (opportunity_id=${row.id}): ${parsed.error.message}`,
      );
    }
    targetOccurrenceIds.push(parsed.data);
    if (target.event_occurrences !== null) {
      const occurrenceResult = mapOccurrenceRow(target.event_occurrences);
      if (!occurrenceResult.ok) {
        return occurrenceResult;
      }
      targetOccurrences.push(occurrenceResult.value);
    }
  }

  const cancellationScopeResult = mapTicketOpportunityCancellationScope(
    row,
    opportunityResult.value.targetScope,
  );
  if (!cancellationScopeResult.ok) {
    return cancellationScopeResult;
  }

  const withTargetsParsed = ticketOpportunityWithTargetsSchema.safeParse({
    opportunity: opportunityResult.value,
    targetOccurrenceIds,
  });
  if (!withTargetsParsed.success) {
    return err(
      `Invalid ticket_opportunities row (id=${row.id}) target scope: ${withTargetsParsed.error.message}`,
    );
  }

  if (row.events === null) {
    return err(
      `Invalid ticket_opportunities row (id=${row.id}): parent events row missing while reading display context.`,
    );
  }
  const eventDisplay = eventDisplaySchema.safeParse(row.events);
  if (!eventDisplay.success) {
    return err(
      `Invalid ticket_opportunities row (id=${row.id}) event display context: ${eventDisplay.error.message}`,
    );
  }

  const milestones: TicketOpportunityMilestone[] = [];
  for (const milestoneRow of row.ticket_opportunity_milestones) {
    const milestoneResult = mapTicketOpportunityMilestoneRow(milestoneRow);
    if (!milestoneResult.ok) {
      return milestoneResult;
    }
    milestones.push(milestoneResult.value);
  }

  return ok({
    opportunityWithTargets: withTargetsParsed.data,
    milestones,
    cancellationScope: cancellationScopeResult.value,
    isEffectivelyCanceled: isTicketOpportunityEffectivelyCanceled(
      cancellationScopeResult.value,
    ),
    eventTitle: eventDisplay.data.title,
    eventVenue: eventDisplay.data.venue,
    targetOccurrences,
  });
}

/**
 * TicketOpportunity + milestones + target occurrences を shared catalog
 * data として読む（`/tickets`・`/` home の両方が使う -
 * `docs/v2/oracle-routes-ui.md` §1 `listTicketOpportunitiesWithDetails`
 * の shared 部分）。
 *
 * `ticket_opportunities`/`ticket_opportunity_target_occurrences`/
 * `ticket_opportunity_milestones` はいずれも `using (true)` の shared
 * read-only catalog（`docs/v2/oracle-database.md` §2）なので、
 * authenticated である限り0件は常に「本当に0件」。
 *
 * 個人の planning state（`user_ticket_opportunity_states`）は意図的に
 * 別関数（`listMyTicketOpportunityStates`）に分離した。
 * `docs/v2/decisions.md` P4「read ごとに独立して劣化」に従い、shared
 * catalog の読み込みと自分の planning state の読み込みのどちらか片方が
 * 失敗しても、他方は独立して表示継続できるようにするため。
 */
export async function listTicketOpportunities(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly TicketOpportunityDetail[]>> {
  const query = client
    .from("ticket_opportunities")
    .select(
      "*, events(title, venue, canceled_at), ticket_opportunity_target_occurrences(occurrence_id, event_occurrences(*)), ticket_opportunity_milestones(*)",
    );

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapTicketOpportunityListRow);
}

/**
 * 自分の personal planning state（`planned`/`applied`）を読む。
 * `user_id = userId` フィルタは RLS の「本人の行のみ」
 * （`docs/v2/oracle-database.md` §2）と完全に一致するため、0件は常に
 * 「本当に登録していない」であり、unavailable が empty へ化ける余地は
 * ない。
 */
export async function listMyTicketOpportunityStates(
  client: SupabaseClient<Database>,
  userId: UserId,
): Promise<ReadResult<readonly UserTicketOpportunityState[]>> {
  const query = client
    .from("user_ticket_opportunity_states")
    .select("*")
    .eq("user_id", userId);

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapUserTicketOpportunityStateRow);
}

/**
 * `listTicketOpportunities` + `listMyTicketOpportunityStates` の結果を
 * `@stage-tracker/domain` の `TicketOpportunityAggregate`
 * （`ticketOpportunityTimeline.ts` の timeline 計算の入力形）へ純粋に
 * 組み立てる pure combinator。
 *
 * 意図的に `ReadResult` を返さない（例外も投げない、常に成功する）:
 * 呼び出し元は両方の read が独立して成功した場合にのみこれを呼ぶことを
 * 想定するが、「片方が失敗した場合にどう縮退表示するか」は screen 層の
 * 判断であり、この data 層では決めない（P4 の独立劣化の精神を壊さない
 * ため、失敗時のフォールバック仕様をここへ埋め込まない）。
 */
export function buildTicketOpportunityAggregates(
  opportunities: readonly TicketOpportunityDetail[],
  myStates: readonly UserTicketOpportunityState[],
): readonly TicketOpportunityAggregate[] {
  const myStateByOpportunityId = new Map(
    myStates.map((state) => [state.opportunityId, state.status] as const),
  );
  return opportunities.map((detail) => ({
    opportunityId: detail.opportunityWithTargets.opportunity.id,
    eventId: detail.opportunityWithTargets.opportunity.eventId,
    // PR #381 review finding 2: displayName は timeline row まで運ばれ、
    // 同日に複数の同種 milestone（例: 複数 Opportunity の
    // application_close）があっても行を判別できるようにする
    // (`TicketsView.tsx`/`home-loader.ts` では、この識別子に加えて
    // `TicketOpportunityDetail.eventTitle` を表示文脈として使う)。
    displayName: detail.opportunityWithTargets.opportunity.displayName,
    milestones: detail.milestones,
    myState:
      myStateByOpportunityId.get(
        detail.opportunityWithTargets.opportunity.id,
      ) ?? null,
  }));
}
