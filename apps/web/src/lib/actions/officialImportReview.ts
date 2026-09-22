import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok, type Result } from "@stage-tracker/domain";
import type { BaseActionErrorKind } from "@/lib/action-error";
import type { Database } from "@/lib/data/database.types";

export type OfficialImportReviewDecision = "approved" | "rejected";

interface OfficialImportReviewError {
  readonly kind: Extract<
    BaseActionErrorKind,
    "permission-denied" | "validation" | "failure"
  >;
  readonly message: string;
}

export async function reviewOfficialImportCandidate(
  client: SupabaseClient<Database>,
  input: {
    readonly candidateId: string;
    readonly decision: OfficialImportReviewDecision;
  },
): Promise<
  Result<
    { readonly reviewStatus: OfficialImportReviewDecision },
    OfficialImportReviewError
  >
> {
  const { data, error } = await client.rpc("review_official_import_candidate", {
    p_candidate_id: input.candidateId,
    p_review_status: input.decision,
  });
  if (error !== null) {
    console.error("[official import review] RPC failed", {
      code: error.code,
      message: error.message,
    });
    if (error.code === "42501") {
      return err({
        kind: "permission-denied",
        message: "公式情報を確認する権限がありません。",
      });
    }
    if (error.code === "22023") {
      return err({
        kind: "validation",
        message: "この候補は現在確認できません。画面を再読み込みしてください。",
      });
    }
    return err({
      kind: "failure",
      message:
        "確認結果を保存できませんでした。時間をおいて再度お試しください。",
    });
  }
  if (data === null || data.review_status !== input.decision) {
    console.error("[official import review] RPC returned an invalid result");
    return err({
      kind: "failure",
      message:
        "確認結果を保存できませんでした。時間をおいて再度お試しください。",
    });
  }
  return ok({ reviewStatus: input.decision });
}
