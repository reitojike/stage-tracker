import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  ok,
  scheduleShareIdSchema,
  type PersonalScheduleEntryId,
  type Result,
  type ScheduleShareId,
  type UserId,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import { mapRows } from "../row-mapping";
import { readError, type ReadError } from "../read-error";
import type { ReadResult } from "../read-result";
import {
  classifyPostgrestError,
  runSupabaseRpc,
  runSupabaseSelect,
} from "../supabase-select";

export interface ScheduleShareRecipient {
  readonly shareId: ScheduleShareId;
  readonly recipientEmail: string;
  readonly sharedAt: string;
}

function mapScheduleShareIdRow(row: {
  readonly id: string;
}): Result<ScheduleShareId, string> {
  const parsed = scheduleShareIdSchema.safeParse(row.id);
  return parsed.success
    ? ok(parsed.data)
    : err(`Invalid personal_schedule_shares row (id=${row.id}).`);
}

/**
 * Resolve only the caller's own relation for one entry. The explicit
 * recipient predicate is required because the table RLS policy also lets an
 * entry owner read every relation for that entry.
 */
export async function getOwnScheduleShareId(
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
  userId: UserId,
): Promise<ReadResult<ScheduleShareId | null>> {
  const rowsResult = await runSupabaseSelect(
    client
      .from("personal_schedule_shares")
      .select("id")
      .eq("schedule_entry_id", entryId)
      .eq("shared_with_user_id", userId)
      .limit(1),
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }

  const mappedResult = mapRows(rowsResult.value, mapScheduleShareIdRow);
  if (!mappedResult.ok) {
    return mappedResult;
  }
  return ok(mappedResult.value[0] ?? null);
}

type ScheduleShareRecipientRow =
  Database["public"]["Functions"]["list_schedule_share_recipient_emails"]["Returns"][number];

function classifyRecipientListRpcError(
  error: PostgrestError,
  status: number,
): ReadError {
  // The existing owner-only RPC uses its current P0001 business-rule signal.
  // Preserve that read meaning here without importing the write-layer
  // ActionError classifier or exposing the raw database message.
  if (error.code === "P0001") {
    return readError("permission-denied");
  }
  return classifyPostgrestError(error, status);
}

/**
 * Owner-bounded recipient email projection from the existing SECURITY
 * DEFINER RPC. The RPC remains the authority for owner enforcement and row
 * scoping; this function only converts its result into the typed read
 * contract.
 */
export async function listScheduleShareRecipientEmails(
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
): Promise<ReadResult<readonly ScheduleShareRecipient[]>> {
  const rowsResult = await runSupabaseRpc<ScheduleShareRecipientRow>(
    client.rpc("list_schedule_share_recipient_emails", {
      p_schedule_entry_id: entryId,
    }),
    classifyRecipientListRpcError,
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }

  return mapRows(rowsResult.value, (row) => {
    const parsedShareId = scheduleShareIdSchema.safeParse(row.share_id);
    if (!parsedShareId.success) {
      return err(
        `Invalid schedule share recipient row (share_id=${row.share_id}).`,
      );
    }
    return ok({
      shareId: parsedShareId.data,
      recipientEmail: row.recipient_email,
      sharedAt: row.shared_at,
    });
  });
}
