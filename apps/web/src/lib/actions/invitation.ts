import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  evaluateInvite,
  ok,
  type InviteOutcome,
  type InviteRejectionReason,
  type OccurrenceId,
  type ParticipationStatus,
  type Result,
  type UserId,
} from "@stage-tracker/domain";
import type { ActionErrorShape } from "@/lib/action-error";

/**
 * invite の書き込み core（`docs/v2/oracle-routes-ui.md` §1/§2 イベント詳細
 * の `inviteToOccurrenceAction`）。
 *
 * **opacity boundary（AGENTS.md「Invitation」、`docs/v2/decisions.md`
 * 「v2実装で踏んではいけない地雷」）**: invitee の private な participation
 * 状態が inviter へ漏れる経路を作らないこと。この関数が inviter へ返す
 * 成功値は `@stage-tracker/domain` の `evaluateInvite` が返す
 * `InviteOutcome`（`'invite-sent'` という単一リテラル型）そのものであり、
 * invitee 依存のフィールドを後から足せる container ではない
 * （`packages/domain/src/invitation/inviteOpacity.ts` の型コメント参照）。
 *
 * この関数は invitee の participation 状態を**一度も読まない**。読むのは
 * 常に (a) inviter 自身の participation 状態、(b) occurrence の
 * cancellation 状態（shared/public な事実）、(c) inviter 自身の登録
 * email との文字列比較（self-invite 判定）——いずれも invitee の private
 * state ではない。invitee 側の3分岐（行なし/considering/attending）の
 * 実際の解決は、SECURITY DEFINER の `invite_to_occurrence_by_email` RPC
 * （常に `void` を返す）に完全に委譲する。
 */

const OCCURRENCE_CANCELED_SQLSTATE = "90002";

export type InviteToOccurrenceErrorKind =
  ActionErrorShape<"occurrence-canceled">;

interface PostgrestLikeError {
  readonly code?: string | null;
  readonly message: string;
}

function mapInviteRejection(
  reason: InviteRejectionReason,
): InviteToOccurrenceErrorKind {
  switch (reason) {
    case "self-invite":
      return {
        kind: "validation",
        message: "自分自身を招待することはできません。",
      };
    case "occurrence-effectively-canceled":
      return {
        kind: "occurrence-canceled",
        message: "この公演回は中止されているため、招待できません。",
      };
    case "inviter-not-attending":
      return {
        kind: "permission-denied",
        message: "この公演回に参加中（出席予定）でないと招待できません。",
      };
  }
}

function classifyInviteRpcError(
  error: PostgrestLikeError,
): InviteToOccurrenceErrorKind {
  if (error.code === OCCURRENCE_CANCELED_SQLSTATE) {
    return {
      kind: "occurrence-canceled",
      message: "この公演回は中止されているため、招待できません。",
    };
  }
  // `docs/v2/decisions.md` A8: message match をしない。事前チェック
  // (`evaluateInvite`) を通過した後に RPC 自身が拒否するのは、
  // self-invite/inviter-not-attending の再チェックが引っかかる race
  // くらいで、いずれも custom SQLSTATE を持たない generic exception
  // （`20260830000000_simplify_invitation_pending_only.sql`）。区別する
  // ための string match はしない — 単一の opaque failure として扱う。
  return { kind: "failure", message: "招待を送信できませんでした。" };
}

function isKnownParticipationStatus(
  value: unknown,
): value is ParticipationStatus {
  return value === "attending" || value === "considering";
}

async function fetchOwnParticipationStatus(
  client: SupabaseClient,
  occurrenceId: OccurrenceId,
  userId: UserId,
): Promise<Result<ParticipationStatus | null, InviteToOccurrenceErrorKind>> {
  const { data, error } = await client
    .from("occurrence_participations")
    .select("status")
    .eq("occurrence_id", occurrenceId)
    .eq("user_id", userId)
    .overrideTypes<{ status: string }[]>();

  if (error) {
    return err({
      kind: "failure",
      message: "招待できるか確認できませんでした。",
    });
  }
  const status = data?.[0]?.status;
  return ok(isKnownParticipationStatus(status) ? status : null);
}

async function fetchIsEffectivelyCanceled(
  client: SupabaseClient,
  occurrenceId: OccurrenceId,
): Promise<Result<boolean, InviteToOccurrenceErrorKind>> {
  const { data, error } = await client.rpc(
    "event_occurrence_is_effectively_canceled",
    {
      p_occurrence_id: occurrenceId,
    },
  );

  if (error) {
    return err({
      kind: "failure",
      message: "公演回の状態を確認できませんでした。",
    });
  }
  return ok(Boolean(data));
}

export interface InviteToOccurrenceParams {
  readonly occurrenceId: OccurrenceId;
  readonly inviterUserId: UserId;
  /** 呼び出し元セッションの登録 email。null は「取得できなかった」を表し、
   * self-invite の pre-check を単に諦める（RPC 側の自己招待チェックは
   * 独立して残るため、安全側には倒れる - このタスクの報告参照）。 */
  readonly inviterEmail: string | null;
  /** 既に trim + lower 済みであること（`./invitation.actions.ts` の
   * zod スキーマがこの正規化を担う）。 */
  readonly inviteeEmail: string;
}

export async function inviteToOccurrenceByEmail(
  client: SupabaseClient,
  params: InviteToOccurrenceParams,
): Promise<Result<InviteOutcome, InviteToOccurrenceErrorKind>> {
  const isSelfInvite =
    params.inviterEmail !== null &&
    params.inviterEmail.trim().toLowerCase() === params.inviteeEmail;

  const [participationResult, cancellationResult] = await Promise.all([
    fetchOwnParticipationStatus(
      client,
      params.occurrenceId,
      params.inviterUserId,
    ),
    fetchIsEffectivelyCanceled(client, params.occurrenceId),
  ]);

  if (!participationResult.ok) {
    return err(participationResult.error);
  }
  if (!cancellationResult.ok) {
    return err(cancellationResult.error);
  }

  const evaluation = evaluateInvite({
    isSelfInvite,
    isOccurrenceEffectivelyCanceled: cancellationResult.value,
    inviterParticipationStatus: participationResult.value,
    // evaluateInvite は仕様上この値を一切参照しない
    // (packages/domain/src/invitation/inviteOpacity.ts) - 呼べる値が
    // 無い（invitee の private state を読まない）ので inert な null を渡す。
    inviteeParticipationStatus: null,
  });

  if (!evaluation.ok) {
    return err(mapInviteRejection(evaluation.error));
  }

  const { error: rpcError } = await client.rpc(
    "invite_to_occurrence_by_email",
    {
      p_occurrence_id: params.occurrenceId,
      p_invitee_email: params.inviteeEmail,
    },
  );

  if (rpcError) {
    return err(classifyInviteRpcError(rpcError));
  }

  // `evaluation.value` は `INVITE_OUTCOME`（`'invite-sent'`）そのもの。
  // invitee の3分岐いずれであってもこの1つの値以外は返らない。
  return ok(evaluation.value);
}
