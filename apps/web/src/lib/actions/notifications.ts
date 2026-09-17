"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";
import { authActionClient } from "@/lib/safe-action";
import {
  markNotificationsRead,
  renderedNotificationIdsSchema,
} from "./notification";

const markNotificationsReadInputSchema = z.object({
  notificationIds: renderedNotificationIdsSchema,
});

/**
 * Read-state action for the Notifications screen's rendered snapshot. The
 * input is the exact bounded ID set; the action never derives IDs from time,
 * unread state, or a query performed at action time.
 */
export const markNotificationsReadAction = authActionClient
  .inputSchema(markNotificationsReadInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const result = await markNotificationsRead(
      ctx.supabase,
      parsedInput.notificationIds,
    );
    if (!result.ok) {
      if (result.error.kind !== "validation") {
        revalidateReadSurfaces(affectedReadSurfaces.notificationRead());
      }
      throw new ActionError(result.error.kind, result.error.message);
    }

    revalidateReadSurfaces(affectedReadSurfaces.notificationRead());
    return { ok: true as const };
  });
