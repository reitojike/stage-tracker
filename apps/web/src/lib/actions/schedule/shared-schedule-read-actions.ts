"use server";

import { z } from "zod";
import { personalScheduleEntryIdSchema } from "@stage-tracker/domain";
import { authActionClient } from "@/lib/safe-action";
import { ActionError } from "@/lib/action-error";
import {
  getOwnScheduleShareId,
  getVisiblePersonalScheduleEntry,
  listVisiblePersonalSchedule,
} from "@/lib/data";

// A read acknowledgement, not a grant. Identity is always derived from the
// authenticated session; the existing reads and RLS remain the authority.
export const readSharedScheduleAction = authActionClient
  .inputSchema(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("list") }),
      z.strictObject({
        kind: z.literal("detail"),
        entryId: personalScheduleEntryIdSchema,
      }),
    ]),
  )
  .action(async ({ parsedInput, ctx }) => {
    if (parsedInput.kind === "list") {
      const result = await listVisiblePersonalSchedule(ctx.supabase);
      if (!result.ok)
        throw new ActionError(result.error.kind, result.error.message);
      return {
        kind: "list" as const,
        actorId: ctx.userId,
        entries: result.value.filter((entry) => entry.ownerId !== ctx.userId),
      };
    }
    const [entry, share] = await Promise.all([
      getVisiblePersonalScheduleEntry(ctx.supabase, parsedInput.entryId),
      getOwnScheduleShareId(ctx.supabase, parsedInput.entryId, ctx.userId),
    ]);
    if (!entry.ok) throw new ActionError(entry.error.kind, entry.error.message);
    return {
      kind: "detail" as const,
      actorId: ctx.userId,
      entry: entry.value,
      share,
    };
  });
