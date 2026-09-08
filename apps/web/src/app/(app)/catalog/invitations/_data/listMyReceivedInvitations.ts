import type { SupabaseClient } from "@supabase/supabase-js";
import {
  invitationIdSchema,
  occurrenceIdSchema,
  ok,
  userIdSchema,
  type Event,
  type Occurrence,
  type OccurrenceId,
  type Result,
  type UserId,
} from "@stage-tracker/domain";
import {
  mapEventRow,
  mapOccurrenceRow,
  mapRows,
  runSupabaseSelect,
  type EventRow,
  type OccurrenceRow,
  type ReadResult,
} from "@/lib/data";

/**
 * `/catalog/invitations` の read（`docs/v2/oracle-routes-ui.md` §1 の
 * `listMyReceivedInvitations`）。`occurrence_invitations` の SELECT policy
 * (`occurrence_invitations_select_invitee`) が invitee 本人の行だけを
 * 返すため、`.eq("invitee_id", userId)` は defense-in-depth
 * （`apps/web/src/lib/data/reads/participations.ts` と同じ方針）。
 *
 * pending-only モデル（Issue #225/#230）では行の存在自体が「未回答」を
 * 意味するため、この read が返す全行がそのまま pending invitation。
 *
 * `event_occurrences`/`events` の embed は inner join にしない: FK
 * (`occurrence_invitations.occurrence_id -> event_occurrences.id`) が
 * NO ACTION である限り理論上は必ず解決するはずだが、万一 embed が
 * 解決しない場合でも invitation 行自体（occurrenceId を含む）は
 * 表示・応答操作を続けられるようにし、event/occurrence context だけを
 * 「読み込めませんでした」として個別に fallback する
 * （`docs/v2/oracle-routes-ui.md` §2「Invitation 一覧」の要件）。
 */
export interface ReceivedInvitation {
  readonly invitationId: string;
  readonly occurrenceId: OccurrenceId;
  readonly inviterId: UserId;
  readonly context: {
    readonly occurrence: Occurrence;
    readonly event: Event;
  } | null;
}

interface InvitationRow {
  readonly id: string;
  readonly occurrence_id: string;
  readonly inviter_id: string;
  readonly invitee_id: string;
  readonly event_occurrences:
    (OccurrenceRow & { readonly events: EventRow | null }) | null;
}

function mapInvitationRow(
  row: InvitationRow,
): Result<ReceivedInvitation, string> {
  const invitationIdParsed = invitationIdSchema.safeParse(row.id);
  if (!invitationIdParsed.success) {
    return {
      ok: false,
      error: `Invalid occurrence_invitations row (id=${row.id}): ${invitationIdParsed.error.message}`,
    };
  }
  const occurrenceIdParsed = occurrenceIdSchema.safeParse(row.occurrence_id);
  if (!occurrenceIdParsed.success) {
    return {
      ok: false,
      error: `Invalid occurrence_invitations row (id=${row.id}): ${occurrenceIdParsed.error.message}`,
    };
  }
  const inviterIdParsed = userIdSchema.safeParse(row.inviter_id);
  if (!inviterIdParsed.success) {
    return {
      ok: false,
      error: `Invalid occurrence_invitations row (id=${row.id}): ${inviterIdParsed.error.message}`,
    };
  }

  // `event_occurrences`/`events` の embed が null なら「embed 未解決」
  // として context unavailable へ fallback する（oracle どおり、上記
  // docstring 参照）。embed 自体は存在するのに `mapOccurrenceRow`/
  // `mapEventRow` が失敗する場合はスキーマ drift であり、embed 未解決と
  // 区別して bulk 全体を `err` にする（A10「読めない行を黙って間引かない」
  // - `mapRows` に委ねる）。
  let context: ReceivedInvitation["context"] = null;
  if (row.event_occurrences !== null) {
    const occurrenceResult = mapOccurrenceRow(row.event_occurrences);
    if (!occurrenceResult.ok) {
      return occurrenceResult;
    }
    const eventRow = row.event_occurrences.events;
    if (eventRow !== null) {
      const eventResult = mapEventRow(eventRow);
      if (!eventResult.ok) {
        return eventResult;
      }
      context = {
        occurrence: occurrenceResult.value,
        event: eventResult.value,
      };
    }
  }

  return ok({
    invitationId: invitationIdParsed.data,
    occurrenceId: occurrenceIdParsed.data,
    inviterId: inviterIdParsed.data,
    context,
  });
}

export async function listMyReceivedInvitations(
  client: SupabaseClient,
  userId: string,
): Promise<ReadResult<readonly ReceivedInvitation[]>> {
  const query = client
    .from("occurrence_invitations")
    .select("*, event_occurrences(*, events(*))")
    .eq("invitee_id", userId)
    .order("created_at", { ascending: true })
    .overrideTypes<InvitationRow[]>();

  const rowsResult = await runSupabaseSelect(query);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return mapRows(rowsResult.value, mapInvitationRow);
}
