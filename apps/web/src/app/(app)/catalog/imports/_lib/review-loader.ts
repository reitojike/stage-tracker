import "server-only";

import { z } from "zod";
import {
  err,
  ok,
  type Result,
  type TicketOpportunityMilestone,
} from "@stage-tracker/domain";
import { parseCanonicalProposal } from "@stage-tracker/official-import/durable-candidate";
import type { PostgrestResponse, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/data/database.types";
import {
  mapTicketOpportunityMilestoneRow,
  type TicketOpportunityMilestoneRow,
} from "@/lib/data/mappers/ticketRow";
import { mapRows } from "@/lib/data/row-mapping";
import { readError } from "@/lib/data/read-error";
import type { ReadResult } from "@/lib/data/read-result";
import { runKeysetSupabaseSelect } from "@/lib/data/paged-select";
import { classifyPostgrestError } from "@/lib/data/supabase-select";
import type {
  CurrentEventReviewTarget,
  CurrentTicketOpportunityReviewTarget,
  EventReviewOccurrence,
  EventReviewProposal,
  OfficialImportReviewCandidate,
  TicketOpportunityReviewProposal,
} from "./review-types";

const nullableText = z.string().nullable();
const eventProposalSchema = z
  .object({
    sourceKey: z.string().min(1),
    title: z.string().min(1),
    venue: nullableText,
    memo: nullableText,
    sourceUrl: nullableText,
    startsOn: z.string().min(1),
    endsOn: z.string().min(1),
    occurrences: z.array(
      z.object({
        doorsAt: nullableText,
        startsAt: z.string().min(1),
        endsAt: nullableText,
      }),
    ),
    genre: z.string().min(1).nullable().optional(),
    groups: z
      .array(
        z.object({ key: z.string().min(1), displayName: z.string().min(1) }),
      )
      .optional(),
  })
  .strict();

const milestoneSchema = z.discriminatedUnion("precision", [
  z.object({
    type: z.string().min(1),
    precision: z.literal("date"),
    date: z.string().min(1),
  }),
  z.object({
    type: z.string().min(1),
    precision: z.literal("datetime"),
    at: z.string().min(1),
  }),
  z.object({
    type: z.string().min(1),
    precision: z.literal("window"),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
  }),
]);

const ticketProposalSchema = z
  .object({
    eventSourceKey: z.string().min(1),
    sourceKey: z.string().min(1),
    displayName: z.string().min(1),
    sourceUrl: nullableText,
    memo: nullableText,
    targetScope: z.enum(["event_wide", "selected_occurrences"]),
    targetOccurrences: z.array(z.string().min(1)),
    milestones: z.array(milestoneSchema),
  })
  .strict();

const currentEventSchema = z
  .object({
    id: z.uuid(),
    source_key: nullableText,
    title: z.string().min(1),
    venue: nullableText,
    memo: nullableText,
    source_url: nullableText,
    starts_on: z.string().min(1),
    ends_on: z.string().min(1),
  })
  .strict();

const currentOccurrenceSchema = z
  .object({
    id: z.uuid(),
    event_id: z.uuid(),
    doors_at: nullableText,
    starts_at: z.string().min(1),
    ends_at: nullableText,
  })
  .strict();

const currentTicketOpportunitySchema = z
  .object({
    id: z.uuid(),
    event_id: z.uuid(),
    source_key: z.string().min(1),
    display_name: z.string().min(1),
    source_url: nullableText,
    memo: nullableText,
    target_scope: z.string().min(1),
  })
  .strict();

const currentTicketTargetSchema = z
  .object({
    opportunity_id: z.uuid(),
    occurrence_id: z.uuid(),
    event_occurrences: z
      .object({
        starts_at: z
          .string()
          .refine(
            (value) => !Number.isNaN(Date.parse(value)),
            "invalid timestamp",
          ),
      })
      .strict()
      .nullable(),
  })
  .strict();

type CurrentTicketTargetRow = z.infer<typeof currentTicketTargetSchema>;

interface TicketTargetCursor {
  readonly opportunityId: string;
  readonly occurrenceId: string;
}

interface CurrentTicketDetails {
  readonly targetOccurrences: readonly string[];
  readonly milestones: TicketOpportunityReviewProposal["milestones"];
}

const evidenceSchema = z
  .object({
    pdfPageNumber: z.number().int().positive().optional(),
    sectionLabel: z.string().min(1).optional(),
    rowLabel: z.string().min(1).optional(),
    fragmentId: z.string().min(1).optional(),
  })
  .strict();

const jevSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    choice: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

const eventPlanSchema = z
  .object({
    version: z.literal("event_plan.v1"),
    action: z.enum(["create", "update", "unchanged"]),
    detailsChanged: z.boolean(),
    rangeChanged: z.boolean(),
    newOccurrenceCount: z.number().int().nonnegative(),
    endsAtFixCount: z.number().int().nonnegative(),
    doorsAtFixCount: z.number().int().nonnegative(),
    keptOccurrenceCount: z.number().int().nonnegative(),
    genreChanged: z.boolean(),
    groupsChanged: z.boolean(),
  })
  .strict();

const ticketPlanSchema = z
  .object({
    version: z.literal("ticket_opportunity_plan.v1"),
    action: z.enum(["create", "update", "unchanged"]),
    eventChanged: z.boolean(),
    detailsChanged: z.boolean(),
    occurrencesChanged: z.boolean(),
    milestonesChanged: z.boolean(),
    targetOccurrenceCount: z.number().int().nonnegative(),
    milestoneCount: z.number().int().nonnegative(),
  })
  .strict();

const candidateRowSchema = z
  .object({
    id: z.uuid(),
    candidate_kind: z.enum(["event", "ticket_opportunity"]),
    source_id: z.string().min(1),
    canonical_url: z.url(),
    observed_at: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), "invalid timestamp"),
    official_external_id: nullableText,
    proposal_version: z.string().min(1),
    proposal: z.unknown(),
    evidence_locator: z.unknown(),
    plan_summary: z.unknown(),
    deterministic_match_status: z.enum([
      "unresolved",
      "matched",
      "unmatched",
      "ambiguous",
    ]),
    semantic_match_status: z.enum([
      "not_used",
      "matched",
      "unmatched",
      "ambiguous",
      "low_confidence",
    ]),
    resolved_event_id: z.uuid().nullable(),
    resolved_ticket_opportunity_id: z.uuid().nullable(),
    jev_decision_evidence: z.unknown().nullable(),
    review_status: z.enum(["pending", "blocked_for_identity_review"]),
    official_import_runs: z.object({ status: z.literal("completed") }),
    current_event: currentEventSchema.nullable(),
    current_ticket_opportunity: currentTicketOpportunitySchema.nullable(),
  })
  .passthrough();

function currentEvent(
  value: z.infer<typeof currentEventSchema> | null,
  occurrences: readonly EventReviewOccurrence[] = [],
): CurrentEventReviewTarget | null {
  return value === null
    ? null
    : {
        id: value.id,
        sourceKey: value.source_key,
        title: value.title,
        venue: value.venue,
        memo: value.memo,
        sourceUrl: value.source_url,
        startsOn: value.starts_on,
        endsOn: value.ends_on,
        occurrences,
      };
}

function currentTicketOpportunity(
  value: z.infer<typeof currentTicketOpportunitySchema> | null,
): CurrentTicketOpportunityReviewTarget | null {
  return value === null
    ? null
    : {
        id: value.id,
        eventId: value.event_id,
        sourceKey: value.source_key,
        displayName: value.display_name,
        sourceUrl: value.source_url,
        memo: value.memo,
        targetScope: value.target_scope,
        targetOccurrences: [],
        milestones: [],
      };
}

function reviewMilestone(
  milestone: TicketOpportunityMilestone,
): TicketOpportunityReviewProposal["milestones"][number] {
  if (milestone.temporalPrecision === "date") {
    return {
      type: milestone.milestoneType,
      precision: "date",
      date: milestone.dateValue,
    };
  }
  if (milestone.temporalPrecision === "datetime") {
    return {
      type: milestone.milestoneType,
      precision: "datetime",
      at: milestone.at,
    };
  }
  return {
    type: milestone.milestoneType,
    precision: "window",
    startsAt: milestone.startsAt,
    endsAt: milestone.endsAt,
  };
}

function blockedReason(row: z.infer<typeof candidateRowSchema>): string | null {
  if (row.review_status !== "blocked_for_identity_review") return null;
  if (row.deterministic_match_status === "ambiguous") {
    return "同一の可能性がある既存イベントが複数、または手動登録イベントを含むため承認できません。公式IDの解決が必要です。";
  }
  if (row.semantic_match_status === "ambiguous") {
    return "意味照合の候補を一意に確定できないため承認できません。公式IDの解決が必要です。";
  }
  if (row.semantic_match_status === "low_confidence") {
    return "既存イベントとの照合結果の信頼度が不足しているため承認できません。公式IDの解決が必要です。";
  }
  return "イベント同一性を確定できないため承認できません。公式IDの解決が必要です。";
}

function eventPlanChanges(plan: z.infer<typeof eventPlanSchema>): string[] {
  const changes: string[] = [];
  if (plan.action === "create") changes.push("新しいイベントを作成");
  if (plan.action === "unchanged") changes.push("現在のイベントから変更なし");
  if (plan.detailsChanged) changes.push("基本情報を更新");
  if (plan.rangeChanged) changes.push("公演期間を更新");
  if (plan.newOccurrenceCount > 0)
    changes.push(`公演回 ${plan.newOccurrenceCount}件を追加`);
  if (plan.endsAtFixCount > 0)
    changes.push(`終演時刻 ${plan.endsAtFixCount}件を補正`);
  if (plan.doorsAtFixCount > 0)
    changes.push(`開場時刻 ${plan.doorsAtFixCount}件を補正`);
  if (plan.genreChanged) changes.push("ジャンルを更新");
  if (plan.groupsChanged) changes.push("グループを更新");
  return changes.length > 0 ? changes : ["構造上の変更なし"];
}

function ticketPlanChanges(plan: z.infer<typeof ticketPlanSchema>): string[] {
  const changes: string[] = [];
  if (plan.action === "create") changes.push("新しいチケット販売情報を作成");
  if (plan.action === "unchanged")
    changes.push("現在のチケット販売情報から変更なし");
  if (plan.eventChanged) changes.push("対象イベントを更新");
  if (plan.detailsChanged) changes.push("基本情報を更新");
  if (plan.occurrencesChanged)
    changes.push(`対象公演回を更新（${plan.targetOccurrenceCount}件）`);
  if (plan.milestonesChanged)
    changes.push(`販売日程を更新（${plan.milestoneCount}件）`);
  return changes.length > 0 ? changes : ["構造上の変更なし"];
}

function mapCandidateRow(
  raw: unknown,
): Result<OfficialImportReviewCandidate, string> {
  const parsed = candidateRowSchema.safeParse(raw);
  if (!parsed.success) return err(parsed.error.message);
  const row = parsed.data;
  if (row.resolved_event_id !== null && row.current_event === null)
    return err(`resolved event is not readable for candidate ${row.id}`);
  if (
    row.resolved_ticket_opportunity_id !== null &&
    row.current_ticket_opportunity === null
  )
    return err(
      `resolved ticket opportunity is not readable for candidate ${row.id}`,
    );

  let proposal: EventReviewProposal | TicketOpportunityReviewProposal;
  try {
    const canonical = parseCanonicalProposal(
      row.candidate_kind,
      row.proposal_version,
      row.proposal,
    );
    if (row.candidate_kind === "event") {
      const value = eventProposalSchema.parse(canonical);
      proposal = {
        kind: "event",
        ...value,
        genre: value.genre ?? null,
        groups: value.groups ?? [],
      };
    } else {
      proposal = {
        kind: "ticket_opportunity",
        ...ticketProposalSchema.parse(canonical),
      };
    }
  } catch (error) {
    return err(
      `invalid canonical proposal for candidate ${row.id}: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const evidence = evidenceSchema.safeParse(row.evidence_locator);
  if (!evidence.success) return err(evidence.error.message);
  const jev =
    row.jev_decision_evidence === null
      ? null
      : jevSchema.safeParse(row.jev_decision_evidence);
  if (jev !== null && !jev.success) return err(jev.error.message);

  let planAction: "create" | "update" | "unchanged";
  let planChanges: string[];
  if (row.candidate_kind === "event") {
    const plan = eventPlanSchema.safeParse(row.plan_summary);
    if (!plan.success) return err(plan.error.message);
    planAction = plan.data.action;
    planChanges = eventPlanChanges(plan.data);
  } else {
    const plan = ticketPlanSchema.safeParse(row.plan_summary);
    if (!plan.success) return err(plan.error.message);
    planAction = plan.data.action;
    planChanges = ticketPlanChanges(plan.data);
  }

  return ok({
    id: row.id,
    kind: row.candidate_kind,
    sourceId: row.source_id,
    canonicalUrl: row.canonical_url,
    observedAt: row.observed_at,
    officialExternalId: row.official_external_id,
    reviewStatus: row.review_status,
    proposal,
    currentEvent: currentEvent(row.current_event),
    currentTicketOpportunity: currentTicketOpportunity(
      row.current_ticket_opportunity,
    ),
    plan: {
      action: planAction,
      changes: planChanges,
    },
    evidence: {
      ...(evidence.data.pdfPageNumber === undefined
        ? {}
        : { pdfPageNumber: evidence.data.pdfPageNumber }),
      ...(evidence.data.sectionLabel === undefined
        ? {}
        : { sectionLabel: evidence.data.sectionLabel }),
      ...(evidence.data.rowLabel === undefined
        ? {}
        : { rowLabel: evidence.data.rowLabel }),
      ...(evidence.data.fragmentId === undefined
        ? {}
        : { fragmentId: evidence.data.fragmentId }),
    },
    match: {
      deterministicStatus: row.deterministic_match_status,
      semanticStatus: row.semantic_match_status,
      jev:
        jev === null
          ? null
          : {
              provider: jev.data.provider,
              model: jev.data.model,
              choice: jev.data.choice,
              ...(jev.data.confidence === undefined
                ? {}
                : { confidence: jev.data.confidence }),
            },
    },
    blockedReason: blockedReason(row),
  });
}

export async function loadOfficialImportReviewQueue(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly OfficialImportReviewCandidate[]>> {
  const rows = await runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("official_import_candidates")
      .select(
        `*,
         official_import_runs!inner(status),
         current_event:events!official_import_candidates_resolved_event_id_fkey(
           id, source_key, title, venue, memo, source_url, starts_on, ends_on
         ),
         current_ticket_opportunity:ticket_opportunities!official_import_candidates_resolved_ticket_opportunity_id_fkey(
           id, event_id, source_key, display_name, source_url, memo, target_scope
         )`,
        { count: "exact" },
      )
      .in("review_status", ["pending", "blocked_for_identity_review"])
      .eq("official_import_runs.status", "completed");
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor
      .order("id", { ascending: true })
      .limit(limit)
      .overrideTypes<z.infer<typeof candidateRowSchema>[]>();
  });
  if (!rows.ok) return rows;
  const candidates = mapRows(rows.value, mapCandidateRow);
  if (!candidates.ok) return candidates;

  const eventIds = candidates.value.flatMap((candidate) =>
    candidate.currentEvent === null ? [] : [candidate.currentEvent.id],
  );
  const occurrences = await loadCurrentEventOccurrences(client, eventIds);
  if (!occurrences.ok) return occurrences;

  const ticketIds = candidates.value.flatMap((candidate) =>
    candidate.currentTicketOpportunity === null
      ? []
      : [candidate.currentTicketOpportunity.id],
  );
  const currentTicketDetails = await loadCurrentTicketDetails(
    client,
    ticketIds,
  );
  if (!currentTicketDetails.ok) return currentTicketDetails;

  return ok(
    candidates.value
      .map((candidate) => {
        const ticketDetails =
          candidate.currentTicketOpportunity === null
            ? undefined
            : currentTicketDetails.value.get(
                candidate.currentTicketOpportunity.id,
              );
        return {
          ...candidate,
          currentEvent:
            candidate.currentEvent === null
              ? null
              : {
                  ...candidate.currentEvent,
                  occurrences:
                    occurrences.value.get(candidate.currentEvent.id) ?? [],
                },
          currentTicketOpportunity:
            candidate.currentTicketOpportunity === null ||
            ticketDetails === undefined
              ? candidate.currentTicketOpportunity
              : {
                  ...candidate.currentTicketOpportunity,
                  ...ticketDetails,
                },
        };
      })
      .toSorted(
        (left, right) =>
          Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
          left.id.localeCompare(right.id),
      ),
  );
}

async function loadCurrentTicketDetails(
  client: SupabaseClient<Database>,
  ticketIds: readonly string[],
): Promise<ReadResult<ReadonlyMap<string, CurrentTicketDetails>>> {
  const uniqueTicketIds = [...new Set(ticketIds)];
  const details = new Map<
    string,
    {
      targetOccurrences: string[];
      milestones: TicketOpportunityReviewProposal["milestones"][number][];
    }
  >(
    uniqueTicketIds.map((id) => [
      id,
      { targetOccurrences: [], milestones: [] },
    ]),
  );

  for (let index = 0; index < uniqueTicketIds.length; index += 100) {
    const ticketIdChunk = uniqueTicketIds.slice(index, index + 100);
    const targets = await loadCurrentTicketTargets(client, ticketIdChunk);
    if (!targets.ok) return targets;
    for (const target of targets.value) {
      const parsed = currentTicketTargetSchema.safeParse(target);
      if (!parsed.success || parsed.data.event_occurrences === null) {
        console.error(
          "[official import review] invalid current ticket target row",
          parsed.success ? "occurrence is not readable" : parsed.error.message,
        );
        return err(readError("failure"));
      }
      const detail = details.get(parsed.data.opportunity_id);
      if (detail === undefined) {
        console.error(
          "[official import review] ticket target escaped its requested scope",
        );
        return err(readError("failure"));
      }
      detail.targetOccurrences.push(parsed.data.event_occurrences.starts_at);
    }

    const milestoneRows = await runKeysetSupabaseSelect((cursor, limit) => {
      const query = client
        .from("ticket_opportunity_milestones")
        .select("*", { count: "exact" })
        .in("opportunity_id", ticketIdChunk);
      const afterCursor = cursor === null ? query : query.gt("id", cursor);
      return afterCursor
        .order("id", { ascending: true })
        .limit(limit)
        .overrideTypes<TicketOpportunityMilestoneRow[]>();
    });
    if (!milestoneRows.ok) return milestoneRows;
    const milestones = mapRows(
      milestoneRows.value,
      mapTicketOpportunityMilestoneRow,
    );
    if (!milestones.ok) {
      console.error(
        "[official import review] invalid current ticket milestone row",
        milestones.error,
      );
      return err(readError("failure"));
    }
    for (const milestone of milestones.value) {
      const detail = details.get(milestone.opportunityId);
      if (detail === undefined) {
        console.error(
          "[official import review] ticket milestone escaped its requested scope",
        );
        return err(readError("failure"));
      }
      detail.milestones.push(reviewMilestone(milestone));
    }
  }

  for (const detail of details.values()) {
    detail.targetOccurrences.sort();
  }
  return ok(details);
}

async function loadCurrentTicketTargets(
  client: SupabaseClient<Database>,
  ticketIds: readonly string[],
): Promise<ReadResult<readonly CurrentTicketTargetRow[]>> {
  const rows: CurrentTicketTargetRow[] = [];
  const seenKeys = new Set<string>();
  let cursor: TicketTargetCursor | null = null;

  for (;;) {
    let response: PostgrestResponse<CurrentTicketTargetRow>;
    try {
      const query = client
        .from("ticket_opportunity_target_occurrences")
        .select("opportunity_id, occurrence_id, event_occurrences(starts_at)", {
          count: "exact",
        })
        .in("opportunity_id", ticketIds);
      const afterCursor =
        cursor === null
          ? query
          : query.or(
              `opportunity_id.gt.${cursor.opportunityId},and(opportunity_id.eq.${cursor.opportunityId},occurrence_id.gt.${cursor.occurrenceId})`,
            );
      response = await afterCursor
        .order("opportunity_id", { ascending: true })
        .order("occurrence_id", { ascending: true })
        .limit(500)
        .overrideTypes<CurrentTicketTargetRow[]>();
    } catch (thrown) {
      console.error(
        "[official import review] unexpected exception during current ticket target SELECT",
        thrown,
      );
      return err(readError("failure"));
    }

    if (response.error !== null) {
      return err(classifyPostgrestError(response.error, response.status));
    }
    if (response.count === null || response.data === null) {
      console.error(
        "[official import review] current ticket target SELECT omitted completeness metadata",
      );
      return err(readError("failure"));
    }
    if (response.data.length === 0) {
      if (response.count === 0) break;
      console.error(
        "[official import review] current ticket target SELECT returned no rows before completion",
      );
      return err(readError("failure"));
    }

    for (const row of response.data) {
      const parsed = currentTicketTargetSchema.safeParse(row);
      if (!parsed.success) {
        console.error(
          "[official import review] invalid current ticket target row",
          parsed.error.message,
        );
        return err(readError("failure"));
      }
      const key = `${parsed.data.opportunity_id}:${parsed.data.occurrence_id}`;
      if (seenKeys.has(key)) {
        console.error(
          `[official import review] current ticket target SELECT returned duplicate key=${key}`,
        );
        return err(readError("failure"));
      }
      seenKeys.add(key);
      rows.push(parsed.data);
    }

    const lastRow = rows.at(-1);
    if (lastRow === undefined) return err(readError("failure"));
    const nextCursor = {
      opportunityId: lastRow.opportunity_id,
      occurrenceId: lastRow.occurrence_id,
    };
    if (
      cursor !== null &&
      (nextCursor.opportunityId < cursor.opportunityId ||
        (nextCursor.opportunityId === cursor.opportunityId &&
          nextCursor.occurrenceId <= cursor.occurrenceId))
    ) {
      console.error(
        "[official import review] current ticket target SELECT made no cursor progress",
      );
      return err(readError("failure"));
    }
    cursor = nextCursor;
    if (response.count <= response.data.length) break;
  }

  return ok(rows);
}

async function loadCurrentEventOccurrences(
  client: SupabaseClient<Database>,
  eventIds: readonly string[],
): Promise<ReadResult<ReadonlyMap<string, readonly EventReviewOccurrence[]>>> {
  const uniqueEventIds = [...new Set(eventIds)];
  const grouped = new Map<string, EventReviewOccurrence[]>();

  for (let index = 0; index < uniqueEventIds.length; index += 100) {
    const eventIdChunk = uniqueEventIds.slice(index, index + 100);
    const rows = await runKeysetSupabaseSelect((cursor, limit) => {
      const query = client
        .from("event_occurrences")
        .select("id, event_id, doors_at, starts_at, ends_at", {
          count: "exact",
        })
        .in("event_id", eventIdChunk)
        .is("canceled_at", null);
      const afterCursor = cursor === null ? query : query.gt("id", cursor);
      return afterCursor
        .order("id", { ascending: true })
        .limit(limit)
        .overrideTypes<z.infer<typeof currentOccurrenceSchema>[]>();
    });
    if (!rows.ok) return rows;

    for (const raw of rows.value) {
      const parsed = currentOccurrenceSchema.safeParse(raw);
      if (!parsed.success) {
        console.error(
          "[official import review] invalid current occurrence row",
          parsed.error.message,
        );
        return err(readError("failure"));
      }
      const existing = grouped.get(parsed.data.event_id) ?? [];
      existing.push({
        id: parsed.data.id,
        doorsAt: parsed.data.doors_at,
        startsAt: parsed.data.starts_at,
        endsAt: parsed.data.ends_at,
      });
      grouped.set(parsed.data.event_id, existing);
    }
  }

  for (const occurrenceList of grouped.values()) {
    occurrenceList.sort(
      (left, right) =>
        Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
        (left.id ?? "").localeCompare(right.id ?? ""),
    );
  }
  return ok(grouped);
}
