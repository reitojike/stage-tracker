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

export const dismissFailedOfficialImportCandidateAction = authActionClient
  .inputSchema(z.object({ candidateId: z.uuid() }).strict())
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase.rpc(
      "dismiss_failed_official_import_candidate",
      { p_candidate_id: parsedInput.candidateId },
    );
    if (error !== null || data !== true) {
      if (error?.code === "42501")
        throw new ActionError(
          "permission-denied",
          "公式情報を確認する権限がありません。",
        );
      if (error?.code === "22023")
        throw new ActionError(
          "validation",
          "この候補は閉じられません。画面を再読み込みしてください。",
        );
      console.error("[official import dismissal] RPC failed", {
        code: error?.code,
        message: error?.message,
      });
      throw new ActionError(
        "failure",
        "候補を閉じられませんでした。しばらくして再試行してください。",
      );
    }
    revalidateReadSurfaces(affectedReadSurfaces.officialImportReview());
    return { dismissed: true as const };
  });

const bindTicketInputSchema = z
  .object({ candidateId: z.uuid(), eventId: z.uuid() })
  .strict();

export const bindOfficialImportTicketCandidateAction = authActionClient
  .inputSchema(bindTicketInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase.rpc(
      "bind_official_import_ticket_candidate",
      {
        p_candidate_id: parsedInput.candidateId,
        p_event_id: parsedInput.eventId,
      },
    );
    if (error !== null || data?.review_status !== "approved") {
      if (error?.code === "42501")
        throw new ActionError(
          "permission-denied",
          "公式情報を確認する権限がありません。",
        );
      if (error?.code === "22023")
        throw new ActionError(
          "validation",
          "候補またはEventが確認できません。画面を再読み込みしてください。",
        );
      console.error("[official import manual binding] RPC failed", {
        code: error?.code,
        message: error?.message,
      });
      throw new ActionError(
        "failure",
        "紐づけを保存できませんでした。しばらくして再試行してください。",
      );
    }
    revalidateReadSurfaces(affectedReadSurfaces.officialImportReview());
    return { reviewStatus: "approved" as const };
  });

export const lookupOfficialImportBindingEventAction = authActionClient
  .inputSchema(z.object({ eventId: z.uuid() }).strict())
  .action(async ({ parsedInput, ctx }) => {
    const { data, error } = await ctx.supabase
      .from("events")
      .select("id, title, venue, starts_on, ends_on")
      .eq("id", parsedInput.eventId)
      .is("canceled_at", null)
      .maybeSingle();
    if (error !== null) {
      console.error("[official import manual binding] Event lookup failed", {
        code: error.code,
        message: error.message,
      });
      throw new ActionError("failure", "Eventを確認できませんでした。");
    }
    if (data === null)
      throw new ActionError(
        "validation",
        "紐づけ可能なEventが見つかりません。",
      );
    return {
      id: data.id,
      title: data.title,
      venue: data.venue,
      startsOn: data.starts_on,
      endsOn: data.ends_on,
    };
  });
