import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  invitationIdSchema,
  ok,
  occurrenceIdSchema,
  type OccurrenceId,
  type Result,
  userIdSchema,
  type UserId,
} from "@stage-tracker/domain";
import { z } from "zod";
import type { Database, Tables } from "../database.types";
import { readError, type ReadError } from "../read-error";
import { mapRows } from "../row-mapping";
import type { ReadResult } from "../read-result";
import { runSupabaseSelect } from "../supabase-select";

const notificationRowSchema = z.object({
  id: z.uuid(),
  kind: z.literal("invitation_received"),
  source_id: invitationIdSchema,
  created_at: z.string().min(1),
  read_at: z.string().min(1).nullable(),
});

const invitationSourceRowSchema = z.object({
  id: z.uuid(),
  occurrence_id: occurrenceIdSchema,
  inviter_id: userIdSchema,
  invitee_id: userIdSchema,
});

type NotificationRow = Pick<
  Tables<"notifications">,
  "id" | "kind" | "source_id" | "created_at" | "read_at"
>;

type InvitationSourceRow = Pick<
  Tables<"occurrence_invitations">,
  "id" | "occurrence_id" | "inviter_id" | "invitee_id"
>;

/** The explicit first-window bound for the future Notifications screen. */
export const NOTIFICATION_FIRST_PAGE_SIZE = 50;

export type NotificationSource =
  | {
      readonly status: "active";
      readonly invitationId: string;
      readonly occurrenceId: OccurrenceId;
      readonly inviterId: UserId;
    }
  | { readonly status: "resolved" };

export interface NotificationListItem {
  readonly id: string;
  readonly kind: Database["public"]["Enums"]["notification_kind"];
  readonly sourceId: string;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly source: NotificationSource;
}

export type NotificationQueryPhase = "notification-list" | "source-resolution";

export interface NotificationQueryError extends ReadError {
  readonly phase: NotificationQueryPhase;
}

export type NotificationReadResult<T> = Result<T, NotificationQueryError>;

function phaseError(
  result: ReadResult<unknown>,
  phase: NotificationQueryPhase,
): NotificationQueryError {
  if (result.ok) {
    throw new Error("phaseError requires a failed read result");
  }
  return { ...result.error, phase };
}

function mapNotificationRow(
  row: NotificationRow,
): Result<Omit<NotificationListItem, "source">, string> {
  const parsed = notificationRowSchema.safeParse(row);
  if (!parsed.success) {
    return err(
      `Invalid notifications row (id=${String(row.id)}): ${parsed.error.message}`,
    );
  }
  return ok({
    id: parsed.data.id,
    kind: parsed.data.kind,
    sourceId: parsed.data.source_id,
    createdAt: parsed.data.created_at,
    readAt: parsed.data.read_at,
  });
}

function mapInvitationSourceRow(
  row: InvitationSourceRow,
): Result<NotificationSource & { readonly status: "active" }, string> {
  const parsed = invitationSourceRowSchema.safeParse(row);
  if (!parsed.success) {
    return err(
      `Invalid occurrence_invitations source row (id=${String(row.id)}): ${parsed.error.message}`,
    );
  }
  return ok({
    status: "active",
    invitationId: parsed.data.id,
    occurrenceId: parsed.data.occurrence_id,
    inviterId: parsed.data.inviter_id,
  });
}

async function resolveInvitationSources(
  client: SupabaseClient<Database>,
  notifications: readonly Omit<NotificationListItem, "source">[],
): Promise<NotificationReadResult<ReadonlyMap<string, NotificationSource>>> {
  const sourceIds = [...new Set(notifications.map(({ sourceId }) => sourceId))];
  if (sourceIds.length === 0) {
    return ok(new Map());
  }

  const rowsResult = await runSupabaseSelect(
    client
      .from("occurrence_invitations")
      .select("id, occurrence_id, inviter_id, invitee_id")
      .in("id", sourceIds),
  );
  if (!rowsResult.ok) {
    return err(phaseError(rowsResult, "source-resolution"));
  }

  const mappedResult = mapRows(rowsResult.value, mapInvitationSourceRow);
  if (!mappedResult.ok) {
    return err(phaseError(mappedResult, "source-resolution"));
  }

  const sources = new Map<string, NotificationSource>();
  for (const source of mappedResult.value) {
    if (sources.has(source.invitationId)) {
      console.error(
        `[read] duplicate occurrence_invitations source id=${source.invitationId}`,
      );
      return err({ ...readError("failure"), phase: "source-resolution" });
    }
    sources.set(source.invitationId, source);
  }
  return ok(sources);
}

/**
 * Read the caller's explicit first Notifications window.
 *
 * The recipient is intentionally not an argument. The authenticated Supabase
 * client and `notifications_select_recipient` RLS policy are the ownership
 * boundary. This is a bounded first window, not an implicit full-read: the
 * query has its own small limit and deterministic newest-first ordering.
 * Source invitations are resolved in one batched RLS-scoped read; a
 * missing/invisible source is a normal resolved fallback, while a failed
 * source query remains a source-resolution error.
 */
export async function listMyNotifications(
  client: SupabaseClient<Database>,
): Promise<NotificationReadResult<readonly NotificationListItem[]>> {
  const rowsResult = await runSupabaseSelect(
    client
      .from("notifications")
      .select("id, kind, source_id, created_at, read_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(NOTIFICATION_FIRST_PAGE_SIZE),
  );
  if (!rowsResult.ok) {
    return err(phaseError(rowsResult, "notification-list"));
  }

  const mappedResult = mapRows(rowsResult.value, mapNotificationRow);
  if (!mappedResult.ok) {
    return err(phaseError(mappedResult, "notification-list"));
  }

  const sourcesResult = await resolveInvitationSources(
    client,
    mappedResult.value,
  );
  if (!sourcesResult.ok) {
    return sourcesResult;
  }

  return ok(
    mappedResult.value.map((notification) => ({
      ...notification,
      source: sourcesResult.value.get(notification.sourceId) ?? {
        status: "resolved" as const,
      },
    })),
  );
}

/**
 * AppShell's unread authority: existence of at least one RLS-visible row with
 * `read_at IS NULL`. It deliberately requests one row and never asks for a
 * count or stores a derived boolean.
 */
export async function hasUnreadNotifications(
  client: SupabaseClient<Database>,
): Promise<ReadResult<boolean>> {
  const rowsResult = await runSupabaseSelect(
    client.from("notifications").select("id").is("read_at", null).limit(1),
  );
  if (!rowsResult.ok) {
    return rowsResult;
  }
  return ok(rowsResult.value.length > 0);
}
