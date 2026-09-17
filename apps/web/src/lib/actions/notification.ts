import type { SupabaseClient } from "@supabase/supabase-js";
import { err, ok, type Result } from "@stage-tracker/domain";
import { z } from "zod";
import type { Database } from "@/lib/data/database.types";

export const MAX_RENDERED_NOTIFICATION_IDS = 50;

export const renderedNotificationIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(MAX_RENDERED_NOTIFICATION_IDS)
  .transform((ids) => [...new Set(ids)]);

export interface NotificationReadStateWriteError {
  readonly kind: "validation" | "failure";
  readonly message: string;
}

const WRITE_ERROR_MESSAGE = "お知らせを既読にできませんでした。";

/**
 * Move only the supplied rendered snapshot IDs through the existing
 * recipient-owned single-row RPC. The loop intentionally has no range or
 * mark-all operation. It continues after an individual failure so every
 * supplied ID gets its own bounded attempt; a failed overall Result never
 * claims that any ID was successfully read.
 */
export async function markNotificationsRead(
  client: SupabaseClient<Database>,
  notificationIds: readonly string[],
): Promise<Result<void, NotificationReadStateWriteError>> {
  const parsedIds = renderedNotificationIdsSchema.safeParse(notificationIds);
  if (!parsedIds.success) {
    return err({
      kind: "validation",
      message: "既読にするお知らせIDが正しくありません。",
    });
  }

  let failed = false;
  for (const notificationId of parsedIds.data) {
    try {
      const { error } = await client.rpc("mark_notification_read", {
        p_notification_id: notificationId,
      });
      if (error !== null) {
        failed = true;
        console.error("[notification] mark read failed", error);
      }
    } catch (thrown) {
      failed = true;
      console.error("[notification] unexpected mark read failure", thrown);
    }
  }

  if (failed) {
    return err({ kind: "failure", message: WRITE_ERROR_MESSAGE });
  }
  return ok(undefined);
}
