import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { PostgrestResponse } from "@supabase/supabase-js";
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
import { readError } from "../read-error";
import { classifyPostgrestError } from "../supabase-select";
import type { ReadResult } from "../read-result";
import { runKeysetSupabaseSelect } from "../paged-select";

const MAX_TICKET_IMPORT_GENERATION_ATTEMPTS = 2;

export interface TicketOpportunityListRow extends TicketOpportunityRow {
  readonly events: {
    readonly title: string;
    readonly venue: string | null;
    readonly canceled_at: string | null;
  } | null;
  readonly ticket_opportunity_target_occurrences: readonly {
    readonly opportunity_id: string;
    readonly occurrence_id: string;
    readonly event_occurrences: OccurrenceRow | null;
  }[];
  readonly ticket_opportunity_milestones: readonly TicketOpportunityMilestoneRow[];
}

type TicketOpportunityParentRow = Omit<
  TicketOpportunityListRow,
  "ticket_opportunity_target_occurrences" | "ticket_opportunity_milestones"
>;

type TicketOpportunityTargetRow =
  TicketOpportunityListRow["ticket_opportunity_target_occurrences"][number];

export interface TicketOpportunityDetail {
  readonly opportunityWithTargets: TicketOpportunityWithTargets;
  readonly milestones: readonly TicketOpportunityMilestone[];
  readonly cancellationScope: TicketOpportunityCancellationScope;
  readonly isEffectivelyCanceled: boolean;
  readonly eventTitle: string;
  readonly eventVenue: string | null;
  readonly targetOccurrences: readonly Occurrence[];
}

async function listTicketOpportunityParents(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly TicketOpportunityParentRow[]>> {
  return runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("ticket_opportunities")
      .select("*, events(title, venue, canceled_at)", { count: "exact" });
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor
      .order("id", { ascending: true })
      .limit(limit)
      .overrideTypes<TicketOpportunityParentRow[]>();
  });
}

async function listTicketOpportunityMilestones(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly TicketOpportunityMilestoneRow[]>> {
  return runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("ticket_opportunity_milestones")
      .select("*", { count: "exact" });
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor
      .order("id", { ascending: true })
      .limit(limit)
      .overrideTypes<TicketOpportunityMilestoneRow[]>();
  });
}

interface TicketTargetCursor {
  readonly opportunity_id: string;
  readonly occurrence_id: string;
}

async function listTicketOpportunityTargets(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly TicketOpportunityTargetRow[]>> {
  const rows: TicketOpportunityTargetRow[] = [];
  const seenKeys = new Set<string>();
  let cursor: TicketTargetCursor | null = null;

  for (;;) {
    let response: PostgrestResponse<TicketOpportunityTargetRow>;
    try {
      const query = client
        .from("ticket_opportunity_target_occurrences")
        .select("opportunity_id, occurrence_id, event_occurrences(*)", {
          count: "exact",
        });
      if (cursor === null) {
        response = await query
          .order("opportunity_id", { ascending: true })
          .order("occurrence_id", { ascending: true })
          .limit(500)
          .overrideTypes<TicketOpportunityTargetRow[]>();
      } else {
        response = await query
          .or(
            `opportunity_id.gt.${cursor.opportunity_id},and(opportunity_id.eq.${cursor.opportunity_id},occurrence_id.gt.${cursor.occurrence_id})`,
          )
          .order("opportunity_id", { ascending: true })
          .order("occurrence_id", { ascending: true })
          .limit(500)
          .overrideTypes<TicketOpportunityTargetRow[]>();
      }
    } catch (thrown) {
      console.error(
        "[read] unexpected exception during ticket target keyset SELECT",
        thrown,
      );
      return err(readError("failure"));
    }

    if (response.error !== null) {
      return err(classifyPostgrestError(response.error, response.status));
    }
    if (response.count === null || response.data === null) {
      console.error(
        "[read] ticket target keyset SELECT did not report complete response metadata.",
      );
      return err(readError("failure"));
    }
    if (response.data.length === 0) {
      if (response.count === 0) {
        break;
      }
      console.error(
        `[read] ticket target keyset SELECT returned no rows while exact count was ${response.count}.`,
      );
      return err(readError("failure"));
    }

    for (const row of response.data) {
      const key = `${row.opportunity_id}:${row.occurrence_id}`;
      if (seenKeys.has(key)) {
        console.error(
          `[read] ticket target keyset SELECT returned duplicate key=${key}.`,
        );
        return err(readError("failure"));
      }
      seenKeys.add(key);
      rows.push(row);
    }

    const lastRow: TicketOpportunityTargetRow | undefined =
      response.data.at(-1);
    if (lastRow === undefined) {
      return err(readError("failure"));
    }
    const nextCursor: TicketTargetCursor = {
      opportunity_id: lastRow.opportunity_id,
      occurrence_id: lastRow.occurrence_id,
    };
    if (
      cursor !== null &&
      nextCursor.opportunity_id === cursor.opportunity_id &&
      nextCursor.occurrence_id === cursor.occurrence_id
    ) {
      console.error(
        "[read] ticket target keyset SELECT made no cursor progress.",
      );
      return err(readError("failure"));
    }
    cursor = nextCursor;
    if (response.count <= response.data.length) {
      break;
    }
  }

  return ok(rows);
}

function haveSameTicketImportGeneration(
  before: readonly TicketOpportunityParentRow[],
  after: readonly TicketOpportunityParentRow[],
): boolean {
  return (
    before.length === after.length &&
    before.every(
      (row, index) =>
        row.id === after[index]?.id &&
        row.updated_at === after[index]?.updated_at,
    )
  );
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
 * `specs/008-ticket-opportunity-planning/spec.md` `listTicketOpportunitiesWithDetails`
 * の shared 部分）。
 *
 * `ticket_opportunities`/`ticket_opportunity_target_occurrences`/
 * `ticket_opportunity_milestones` はいずれも `using (true)` の shared
 * read-only catalog（`specs/008-ticket-opportunity-planning/spec.md`）なので、
 * authenticated である限り0件は常に「本当に0件」。全3 resource は
 * exact-count keyset paging で読む。
 *
 * 個人の planning state（`user_ticket_opportunity_states`）は意図的に
 * 別関数（`listMyTicketOpportunityStates`）に分離した。
 * `docs/v2/decisions.md` P4「read ごとに独立して劣化」に従い、shared
 * catalog の読み込みと自分の planning state の読み込みのどちらか片方が
 * 失敗しても、他方は独立して表示継続できるようにするため。
 *
 * `events` と target occurrence の `event_occurrences` は各 parent に
 * 1件の to-one embed なので parent/child pagingで完全性を保てる。一方、
 * target occurrences と milestones は to-many embed であり、PostgRESTの
 * parent rangeだけでは子の `max_rows` 到達を検出できない。したがって
 * parent rowsを先にkeyset readし、to-many resourcesをそれぞれ全件keyset
 * readしてIDで再結合する。これはparentごとのN+1ではなく、最大3つの
 * sequential resource scansに限定した最小のquery shapeである。Import RPCは
 * parent更新時に`updated_at`を更新するため、child scans後にparentのID/
 * `updated_at`を再読して、対応するimport generationがscan中にcommitした
 * ことだけを検証する。これはwhole-list snapshot保証ではない。
 */
export async function listTicketOpportunities(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly TicketOpportunityDetail[]>> {
  for (
    let attempt = 0;
    attempt < MAX_TICKET_IMPORT_GENERATION_ATTEMPTS;
    attempt += 1
  ) {
    const parentRowsResult = await listTicketOpportunityParents(client);
    if (!parentRowsResult.ok) {
      return parentRowsResult;
    }

    const parentIds = new Set(parentRowsResult.value.map((row) => row.id));
    if (parentIds.size === 0) {
      return ok([]);
    }

    const targetRowsResult = await listTicketOpportunityTargets(client);
    if (!targetRowsResult.ok) {
      return targetRowsResult;
    }

    const milestoneRowsResult = await listTicketOpportunityMilestones(client);
    if (!milestoneRowsResult.ok) {
      return milestoneRowsResult;
    }

    const verificationRowsResult = await listTicketOpportunityParents(client);
    if (!verificationRowsResult.ok) {
      return verificationRowsResult;
    }
    if (
      !haveSameTicketImportGeneration(
        parentRowsResult.value,
        verificationRowsResult.value,
      )
    ) {
      if (attempt + 1 < MAX_TICKET_IMPORT_GENERATION_ATTEMPTS) {
        continue;
      }
      console.error(
        "[read] TicketOpportunity import generation kept changing during child paging; refusing to return an unstable aggregate.",
      );
      return err(readError("failure"));
    }

    const targetsByOpportunity = new Map<
      string,
      TicketOpportunityTargetRow[]
    >();
    for (const row of targetRowsResult.value) {
      if (!parentIds.has(row.opportunity_id)) {
        continue;
      }
      const rows = targetsByOpportunity.get(row.opportunity_id) ?? [];
      rows.push(row);
      targetsByOpportunity.set(row.opportunity_id, rows);
    }

    const milestonesByOpportunity = new Map<
      string,
      TicketOpportunityMilestoneRow[]
    >();
    for (const row of milestoneRowsResult.value) {
      if (!parentIds.has(row.opportunity_id)) {
        continue;
      }
      const rows = milestonesByOpportunity.get(row.opportunity_id) ?? [];
      rows.push(row);
      milestonesByOpportunity.set(row.opportunity_id, rows);
    }

    const rows: TicketOpportunityListRow[] = parentRowsResult.value.map(
      (parent) => ({
        ...parent,
        ticket_opportunity_target_occurrences:
          targetsByOpportunity.get(parent.id) ?? [],
        ticket_opportunity_milestones:
          milestonesByOpportunity.get(parent.id) ?? [],
      }),
    );
    return mapRows(rows, mapTicketOpportunityListRow);
  }

  return err(readError("failure"));
}

/**
 * 自分の personal planning state（`planned`/`applied`）を読む。
 * `user_id = userId` フィルタは RLS の「本人の行のみ」
 * （`specs/008-ticket-opportunity-planning/spec.md`）と完全に一致するため、0件は常に
 * 「本当に登録していない」であり、unavailable が empty へ化ける余地は
 * ない。
 */
export async function listMyTicketOpportunityStates(
  client: SupabaseClient<Database>,
  userId: UserId,
): Promise<ReadResult<readonly UserTicketOpportunityState[]>> {
  const rowsResult = await runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("user_ticket_opportunity_states")
      .select("*", { count: "exact" })
      .eq("user_id", userId);
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor.order("id", { ascending: true }).limit(limit);
  });
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
