"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";
import { authActionClient } from "@/lib/safe-action";
import { reviewOfficialImportCandidate } from "./officialImportReview";

const reviewInputSchema = z
  .object({
    candidateId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
  })
  .strict();

export const reviewOfficialImportCandidateAction = authActionClient
  .inputSchema(reviewInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await reviewOfficialImportCandidate(
      ctx.supabase,
      parsedInput,
    );
    if (!result.ok) {
      throw new ActionError(result.error.kind, result.error.message);
    }
    revalidateReadSurfaces(affectedReadSurfaces.officialImportReview());
    return result.value;
  });
