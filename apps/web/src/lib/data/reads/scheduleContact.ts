import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  err,
  ok,
  receivedScheduleContactRequestSchema,
  scheduleContactSchema,
  type ScheduleContact,
  type ReceivedScheduleContactRequest,
} from "@stage-tracker/domain";
import type { Database } from "../database.types";
import { readError, type ReadError } from "../read-error";
import type { ReadResult } from "../read-result";
import { mapRows } from "../row-mapping";
import { runSupabaseRpc } from "../supabase-select";

function contactReadError(error: PostgrestError, status: number): ReadError {
  if (status === 401) return readError("unauthenticated");
  if (status === 403 || error.code === "42501" || error.code === "0A000")
    return readError("permission-denied");
  // Do not log target-dependent SQL text, emails, payloads or network details.
  return readError("failure");
}

export async function getScheduleContactRegistrationEnabled(
  client: SupabaseClient<Database>,
): Promise<ReadResult<boolean>> {
  try {
    const { data, error, status } = await client.rpc(
      "schedule_contact_registration_enabled",
    );
    if (error) return err(contactReadError(error, status));
    return typeof data === "boolean" ? ok(data) : err(readError("failure"));
  } catch {
    return err(readError("failure"));
  }
}

const contactRowSchema = z
  .object({
    contact_id: z.unknown(),
    counterpart_email: z.unknown(),
    own_alias: z.unknown(),
    accepted_at: z.unknown(),
  })
  .transform((row) => ({
    contactId: row.contact_id,
    counterpartEmail: row.counterpart_email,
    ownAlias: row.own_alias,
    acceptedAt: row.accepted_at,
  }))
  .pipe(scheduleContactSchema);
const requestRowSchema = z
  .object({
    request_id: z.unknown(),
    requester_email: z.unknown(),
    requested_at: z.unknown(),
  })
  .transform((row) => ({
    requestId: row.request_id,
    requesterEmail: row.requester_email,
    requestedAt: row.requested_at,
  }))
  .pipe(receivedScheduleContactRequestSchema);

/** No user/email filter: each purpose-built DB RPC derives its caller from auth.uid(). */
export async function listScheduleContacts(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly ScheduleContact[]>> {
  const capability = await getScheduleContactRegistrationEnabled(client);
  if (!capability.ok) return capability;
  if (!capability.value) return err(readError("permission-denied"));
  const result = await runSupabaseRpc(
    client.rpc("list_schedule_contacts").then(
      (r) => r,
      () => {
        throw new Error("Schedule contact read failed");
      },
    ),
    contactReadError,
  );
  if (!result.ok) return result;
  if (!Array.isArray(result.value)) return err(readError("failure"));
  return mapRows(result.value, (row) => {
    const parsed = contactRowSchema.safeParse(row);
    return parsed.success
      ? ok(parsed.data)
      : err("Invalid schedule contact projection");
  });
}

export async function listReceivedScheduleContactRequests(
  client: SupabaseClient<Database>,
): Promise<ReadResult<readonly ReceivedScheduleContactRequest[]>> {
  const capability = await getScheduleContactRegistrationEnabled(client);
  if (!capability.ok) return capability;
  if (!capability.value) return err(readError("permission-denied"));
  const result = await runSupabaseRpc(
    client.rpc("list_received_schedule_contact_requests").then(
      (r) => r,
      () => {
        throw new Error("Schedule contact request read failed");
      },
    ),
    contactReadError,
  );
  if (!result.ok) return result;
  if (!Array.isArray(result.value)) return err(readError("failure"));
  return mapRows(result.value, (row) => {
    const parsed = requestRowSchema.safeParse(row);
    return parsed.success
      ? ok(parsed.data)
      : err("Invalid received contact request projection");
  });
}
