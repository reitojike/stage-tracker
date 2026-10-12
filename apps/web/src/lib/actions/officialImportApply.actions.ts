"use server";

import { z } from "zod";
import { getRun, start } from "workflow/api";
import { ActionError } from "@/lib/action-error";
import { isDesignatedCatalogCreator } from "@/lib/data/creator-capability";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";
import { authActionClient } from "@/lib/safe-action";
import { officialImportApplyWorkflow } from "@/workflows/official-import/apply-workflow";

const applyInputSchema = z.object({ candidateId: z.uuid() }).strict();

export const startOfficialImportApplyAction = authActionClient
  .inputSchema(applyInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    if (!(await isDesignatedCatalogCreator(ctx.supabase, ctx.userId))) {
      throw new ActionError(
        "permission-denied",
        "公式情報を反映する権限がありません。",
      );
    }
    const run = await start(officialImportApplyWorkflow, [
      parsedInput.candidateId,
    ]);
    revalidateReadSurfaces(affectedReadSurfaces.officialImportReview());
    return { workflowRunId: run.runId };
  });

const KABUKI_EVENT_SOURCE_ID = "event.kabuki-bito.schedule";

const applyResultInputSchema = z
  .object({
    candidateId: z.uuid(),
    workflowRunId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  })
  .strict();

export type OfficialImportApplyResultOutcome =
  "pending" | "applied" | "freshness_refused" | "not_applied" | "unconfirmed";

const RESULT_NOT_AVAILABLE_MESSAGE = "この反映結果は確認できません。";

const FAILURE_CLASSIFICATIONS: ReadonlySet<unknown> = new Set([
  "validation",
  "identity_ambiguous",
  "source_changed",
  "target_missing",
  "write_conflict",
  "provider_unavailable",
  "policy_blocked",
  "unexpected",
]);

// The compiler attaches the stable workflow ID that `start` records as the
// run's workflowName. Without it, no run can be attributed to this workflow.
function compiledApplyWorkflowId(): string | null {
  if (!("workflowId" in officialImportApplyWorkflow)) return null;
  const workflowId = officialImportApplyWorkflow.workflowId;
  return typeof workflowId === "string" && workflowId.length > 0
    ? workflowId
    : null;
}

function logLookupFailure(stage: string, error?: unknown): void {
  console.error("[official import apply result] lookup failed", {
    stage,
    errorName: error instanceof Error ? error.name : undefined,
  });
}

function classifyCompletedResult(
  value: unknown,
  candidateId: string,
): OfficialImportApplyResultOutcome {
  if (typeof value !== "object" || value === null) return "unconfirmed";
  if (!("candidateId" in value) || !("status" in value)) return "unconfirmed";
  if (value.candidateId !== candidateId) {
    throw new ActionError("validation", RESULT_NOT_AVAILABLE_MESSAGE);
  }
  if (value.status === "applied") {
    return "outcome" in value &&
      (value.outcome === "written" ||
        value.outcome === "converged" ||
        value.outcome === "already_applied")
      ? "applied"
      : "unconfirmed";
  }
  if (value.status === "freshness_refused") return "freshness_refused";
  if (value.status === "failed") {
    return "failureClassification" in value &&
      FAILURE_CLASSIFICATIONS.has(value.failureClassification)
      ? "not_applied"
      : "unconfirmed";
  }
  if (value.status === "not_approved") return "not_applied";
  return "unconfirmed";
}

/**
 * Reads one Kabuki apply run's state on explicit request. It never waits,
 * polls, restarts or cancels the run and returns only a fixed outcome.
 */
export const checkOfficialImportApplyResultAction = authActionClient
  .inputSchema(applyResultInputSchema)
  .action(
    async ({
      parsedInput,
      ctx,
    }): Promise<{ outcome: OfficialImportApplyResultOutcome }> => {
      if (!(await isDesignatedCatalogCreator(ctx.supabase, ctx.userId))) {
        throw new ActionError(
          "permission-denied",
          "公式情報を確認する権限がありません。",
        );
      }
      const { data: candidate, error } = await ctx.supabase
        .from("official_import_candidates")
        .select("id, source_id, candidate_kind")
        .eq("id", parsedInput.candidateId)
        .maybeSingle();
      if (error !== null) {
        console.error("[official import apply result] candidate read failed", {
          code: error.code,
        });
        return { outcome: "unconfirmed" };
      }
      if (
        candidate === null ||
        candidate.source_id !== KABUKI_EVENT_SOURCE_ID ||
        candidate.candidate_kind !== "event"
      ) {
        throw new ActionError("validation", RESULT_NOT_AVAILABLE_MESSAGE);
      }

      const expectedWorkflowId = compiledApplyWorkflowId();
      if (expectedWorkflowId === null) {
        logLookupFailure("workflow_identity");
        return { outcome: "unconfirmed" };
      }

      let returnValue: unknown;
      try {
        const run = getRun(parsedInput.workflowRunId);
        const workflowName = await run.workflowName;
        if (workflowName !== expectedWorkflowId) {
          throw new ActionError("validation", RESULT_NOT_AVAILABLE_MESSAGE);
        }
        const status = await run.status;
        if (status === "pending" || status === "running") {
          return { outcome: "pending" };
        }
        if (status !== "completed") return { outcome: "unconfirmed" };
        // returnValue waits for completion, so it is read only after the
        // single status check has confirmed a completed run.
        returnValue = await run.returnValue;
      } catch (lookupError) {
        if (lookupError instanceof ActionError) throw lookupError;
        logLookupFailure("run", lookupError);
        return { outcome: "unconfirmed" };
      }
      return {
        outcome: classifyCompletedResult(returnValue, parsedInput.candidateId),
      };
    },
  );
