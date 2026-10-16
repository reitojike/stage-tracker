import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type {
  PersonalScheduleEntryId,
  ScheduleContactId,
  ScheduleContactRequestId,
} from "@stage-tracker/domain";
import {
  ActionError,
  GENERIC_FAILURE_MESSAGE_JA,
  GENERIC_VALIDATION_MESSAGE_JA,
} from "@/lib/action-error";
import type { Database } from "@/lib/data/database.types";
import { getScheduleContactRegistrationEnabled } from "@/lib/data/reads/scheduleContact";

const DISABLED_MESSAGE = "共有相手登録は現在利用できません。";
function contactWriteError(error: PostgrestError, status: number): ActionError {
  if (status === 401)
    return new ActionError<never>("unauthenticated", "サインインが必要です。");
  if (error.code === "0A000")
    return new ActionError<never>("permission-denied", DISABLED_MESSAGE);
  if (status === 403 || error.code === "42501")
    return new ActionError<never>(
      "permission-denied",
      "対象を操作できません。",
    );
  if (error.code === "22023")
    return new ActionError<never>("validation", GENERIC_VALIDATION_MESSAGE_JA);
  // In particular, never reuse the legacy share 90010 email-existence copy.
  return new ActionError<never>("failure", GENERIC_FAILURE_MESSAGE_JA);
}

async function completeContactWrite(
  client: SupabaseClient<Database>,
  write: () => PromiseLike<{ error: PostgrestError | null; status: number }>,
): Promise<void> {
  const capability = await getScheduleContactRegistrationEnabled(client);
  if (!capability.ok)
    throw new ActionError<never>(
      capability.error.kind,
      capability.error.message,
    );
  if (!capability.value)
    throw new ActionError<never>("permission-denied", DISABLED_MESSAGE);
  let response;
  try {
    response = await write();
  } catch {
    throw new ActionError<never>("failure", GENERIC_FAILURE_MESSAGE_JA);
  }
  if (response.error) throw contactWriteError(response.error, response.status);
  // All mutations acknowledge only completion: do not expose returned rows,
  // target ids, counts or a distinction between real requests and no-ops.
}

export async function requestScheduleContact(
  client: SupabaseClient<Database>,
  recipientEmail: string,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("request_schedule_contact_by_email", {
      p_recipient_email: recipientEmail,
    }),
  );
}
export async function cancelScheduleContactRequest(
  client: SupabaseClient<Database>,
  recipientEmail: string,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("cancel_schedule_contact_request_by_email", {
      p_recipient_email: recipientEmail,
    }),
  );
}
export async function acceptScheduleContactRequest(
  client: SupabaseClient<Database>,
  requestId: ScheduleContactRequestId,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("accept_schedule_contact_request", { p_request_id: requestId }),
  );
}
export async function declineScheduleContactRequest(
  client: SupabaseClient<Database>,
  requestId: ScheduleContactRequestId,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("decline_schedule_contact_request", { p_request_id: requestId }),
  );
}
export async function setScheduleContactAlias(
  client: SupabaseClient<Database>,
  contactId: ScheduleContactId,
  alias: string | null,
): Promise<void> {
  // The generated function arg is text, but PostgREST accepts SQL NULL.
  // Empty text has the same DB-defined clear semantics without a type override.
  await completeContactWrite(client, () =>
    client.rpc("set_schedule_contact_alias", {
      p_contact_id: contactId,
      p_alias: alias ?? "",
    }),
  );
}
export async function unlinkScheduleContact(
  client: SupabaseClient<Database>,
  contactId: ScheduleContactId,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("unlink_schedule_contact", { p_contact_id: contactId }),
  );
}
export async function shareScheduleEntryWithContact(
  client: SupabaseClient<Database>,
  entryId: PersonalScheduleEntryId,
  contactId: ScheduleContactId,
): Promise<void> {
  await completeContactWrite(client, () =>
    client.rpc("share_schedule_entry_with_contact", {
      p_schedule_entry_id: entryId,
      p_contact_id: contactId,
    }),
  );
}
