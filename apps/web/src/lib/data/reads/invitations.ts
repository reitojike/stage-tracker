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
import type { Database } from "../database.types";
import {
  mapEventRow,
  mapOccurrenceRow,
  type EventRow,
  type OccurrenceRow,
} from "../mappers/eventRow";
import { runKeysetSupabaseSelect } from "../paged-select";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";

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
  readonly created_at: string;
  readonly occurrence_id: string;
  readonly inviter_id: string;
  readonly invitee_id: string;
  readonly event_occurrences:
    (OccurrenceRow & { readonly events: EventRow | null }) | null;
}

async function listInvitationRows(
  client: SupabaseClient<Database>,
  userId: UserId,
) {
  return runKeysetSupabaseSelect((cursor, limit) => {
    const query = client
      .from("occurrence_invitations")
      .select("*, event_occurrences(*, events(*))", { count: "exact" })
      .eq("invitee_id", userId);
    const afterCursor = cursor === null ? query : query.gt("id", cursor);
    return afterCursor.order("id", { ascending: true }).limit(limit);
  });
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

/** List all pending invitations while preserving keyset paging and context fallback. */
export async function listMyReceivedInvitations(
  client: SupabaseClient<Database>,
  userId: UserId,
): Promise<ReadResult<readonly ReceivedInvitation[]>> {
  const rowsResult = await listInvitationRows(client, userId);
  if (!rowsResult.ok) {
    return rowsResult;
  }
  const orderedRows = [...rowsResult.value].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  return mapRows(orderedRows, mapInvitationRow);
}
