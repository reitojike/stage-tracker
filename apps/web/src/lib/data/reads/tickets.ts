import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  occurrenceIdSchema,
  ok,
  ticketOpportunityWithTargetsSchema,
  type OccurrenceId,
  type Result,
  type TicketOpportunityAggregate,
  type TicketOpportunityMilestone,
  type TicketOpportunityWithTargets,
  type UserId,
  type UserTicketOpportunityState,
} from "@stage-tracker/domain";
import {
  mapTicketOpportunityMilestoneRow,
  mapTicketOpportunityRow,
  mapUserTicketOpportunityStateRow,
  type TicketOpportunityMilestoneRow,
  type TicketOpportunityRow,
  type UserTicketOpportunityStateRow,
} from "../mappers/ticketRow";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

export interface TicketOpportunityListRow extends TicketOpportunityRow {
  readonly ticket_opportunity_target_occurrences: readonly {
    readonly occurrence_id: string;
  }[];
  readonly ticket_opportunity_milestones: readonly TicketOpportunityMilestoneRow[];
}

export interface TicketOpportunityDetail {
  readonly opportunityWithTargets: TicketOpportunityWithTargets;
  readonly milestones: readonly TicketOpportunityMilestone[];
}

function mapTicketOpportunityListRow(
  row: TicketOpportunityListRow,
): Result<TicketOpportunityDetail, string> {
  const opportunityResult = mapTicketOpportunityRow(row);
  if (!opportunityResult.ok) {
    return opportunityResult;
  }

  const targetOccurrenceIds: OccurrenceId[] = [];
  for (const target of row.ticket_opportunity_target_occurrences) {
    const parsed = occurrenceIdSchema.safeParse(target.occurrence_id);
    if (!parsed.success) {
      return err(
        `Invalid ticket_opportunity_target_occurrences row (opportunity_id=${row.id}): ${parsed.error.message}`,
      );
    }
    targetOccurrenceIds.push(parsed.data);
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

  const milestones: TicketOpportunityMilestone[] = [];
  for (const milestoneRow of row.ticket_opportunity_milestones) {
    const milestoneResult = mapTicketOpportunityMilestoneRow(milestoneRow);
    if (!milestoneResult.ok) {
      return milestoneResult;
    }
    milestones.push(milestoneResult.value);
  }

  return ok({ opportunityWithTargets: withTargetsParsed.data, milestones });
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
  client: SupabaseClient,
): Promise<ReadResult<readonly TicketOpportunityDetail[]>> {
  const query = client
    .from("ticket_opportunities")
    .select(
      "*, ticket_opportunity_target_occurrences(occurrence_id), ticket_opportunity_milestones(*)",
    )
    .overrideTypes<TicketOpportunityListRow[]>();

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
  client: SupabaseClient,
  userId: UserId,
): Promise<ReadResult<readonly UserTicketOpportunityState[]>> {
  const query = client
    .from("user_ticket_opportunity_states")
    .select("*")
    .eq("user_id", userId)
    .overrideTypes<UserTicketOpportunityStateRow[]>();

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
    milestones: detail.milestones,
    myState:
      myStateByOpportunityId.get(
        detail.opportunityWithTargets.opportunity.id,
      ) ?? null,
  }));
}
