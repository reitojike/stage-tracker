import type { SupabaseClient } from "@supabase/supabase-js";
import {
  err,
  instantSchema,
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

/** The bounded number of Notifications rendered in one navigable window. */
export const NOTIFICATION_PAGE_SIZE = 50;
/** @deprecated Use NOTIFICATION_PAGE_SIZE for the current bounded window. */
export const NOTIFICATION_FIRST_PAGE_SIZE = NOTIFICATION_PAGE_SIZE;

const notificationCursorSchema = z.object({
  // Validate as an Instant without using its Date-backed transformed output:
  // PostgreSQL timestamptz can contain microseconds that a JS Date truncates.
  createdAt: z
    .string()
    .refine(
      (value) => instantSchema.safeParse(value).success,
      "Expected a valid instant",
    ),
  id: z.uuid(),
});

export interface NotificationCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeNotificationCursor(
  value: string | null | undefined,
): NotificationCursor | null {
  if (value === null || value === undefined || value.length === 0) {
    return null;
  }

  try {
    const parsed = notificationCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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

export interface NotificationPage {
  readonly items: readonly NotificationListItem[];
  readonly nextCursor: NotificationCursor | null;
  readonly hasPrevious: boolean;
}

export interface NotificationPageOptions {
  readonly before?: NotificationCursor | null;
  readonly snapshot?: NotificationCursor | null;
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
 * Read one bounded Notifications window after the supplied cursor.
 *
 * The recipient is intentionally not an argument. The authenticated Supabase
 * client and `notifications_select_recipient` RLS policy are the ownership
 * boundary. This is a bounded page, not an implicit full-read: the query has
 * its own small look-ahead limit and deterministic keyset ordering. A
 * snapshot cursor keeps all navigated windows on one high-water mark, while a
 * before cursor supports bounded previous-window navigation without a growing
 * URL trail.
 * Source invitations are resolved in one batched RLS-scoped read; a
 * missing/invisible source is a normal resolved fallback, while a failed
 * source query remains a source-resolution error.
 */
export async function listMyNotifications(
  client: SupabaseClient<Database>,
  cursor: NotificationCursor | null = null,
  options: NotificationPageOptions = {},
): Promise<NotificationReadResult<NotificationPage>> {
  let query = client
    .from("notifications")
    .select("id, kind, source_id, created_at, read_at");

  const before = options.before ?? null;
  const snapshot = options.snapshot ?? null;
  if (before !== null) {
    query = query.or(
      `created_at.gt.${before.createdAt},and(created_at.eq.${before.createdAt},id.gt.${before.id})`,
    );
  } else if (cursor !== null) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }
  if (snapshot !== null) {
    query = query.or(
      `created_at.lt.${snapshot.createdAt},and(created_at.eq.${snapshot.createdAt},id.lte.${snapshot.id})`,
    );
  }

  const rowsResult = await runSupabaseSelect(
    query
      .order("created_at", { ascending: before !== null })
      .order("id", { ascending: before !== null })
      .limit(NOTIFICATION_PAGE_SIZE + 1),
  );
  if (!rowsResult.ok) {
    return err(phaseError(rowsResult, "notification-list"));
  }

  const mappedResult = mapRows(rowsResult.value, mapNotificationRow);
  if (!mappedResult.ok) {
    return err(phaseError(mappedResult, "notification-list"));
  }

  const pageRows =
    before === null
      ? mappedResult.value.slice(0, NOTIFICATION_PAGE_SIZE)
      : mappedResult.value.slice(0, NOTIFICATION_PAGE_SIZE).reverse();
  const hasNextPage = mappedResult.value.length > NOTIFICATION_PAGE_SIZE;
  const lastRow = pageRows.at(-1);
  const nextCursor =
    (before !== null || hasNextPage) && lastRow !== undefined
      ? { createdAt: lastRow.createdAt, id: lastRow.id }
      : null;

  const sourcesResult = await resolveInvitationSources(client, pageRows);
  if (!sourcesResult.ok) {
    return sourcesResult;
  }

  return ok({
    items: pageRows.map((notification) => ({
      ...notification,
      source: sourcesResult.value.get(notification.sourceId) ?? {
        status: "resolved" as const,
      },
    })),
    nextCursor,
    hasPrevious:
      before !== null ? hasNextPage : cursor !== null && snapshot !== null,
  });
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
