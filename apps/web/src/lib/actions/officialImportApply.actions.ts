"use server";

import { z } from "zod";
import { start } from "workflow/api";
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
