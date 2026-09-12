"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ticketOpportunityIdSchema,
  userIdSchema,
  userTicketOpportunityStatusSchema,
} from "@stage-tracker/domain";
import { ActionError } from "@/lib/action-error";
import { authActionClient } from "@/lib/safe-action";
import {
  removeMyTicketOpportunityState,
  setMyTicketOpportunityState,
} from "./ticketOpportunityState";

const TICKET_OPPORTUNITY_STATE_INTENTS = [
  "planned",
  "applied",
  "remove",
] as const;

const updateTicketOpportunityStateInputSchema = z.object({
  opportunityId: ticketOpportunityIdSchema,
  intent: z.enum(TICKET_OPPORTUNITY_STATE_INTENTS),
});

/**
 * `docs/v2/oracle-routes-ui.md`「`/tickets`」行の
 * `updateTicketOpportunityStateAction`→`user_ticket_opportunity_states` の
 * upsert/delete（`intent`: `planned`|`applied`|`remove`、常に
 * `user_id=caller` で scope）。M8 の difference inventory（#401）で確定した
 * v2 の不具合（この write UI 自体が未実装だった）の修正。
 *
 * `/tickets` と、同じ personal planning state を期限カードへ表示する `/`
 * を再検証する。
 */
export const updateTicketOpportunityStateAction = authActionClient
  .inputSchema(updateTicketOpportunityStateInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    const userId = userIdSchema.parse(ctx.userId);

    if (parsedInput.intent === "remove") {
      const result = await removeMyTicketOpportunityState(ctx.supabase, {
        opportunityId: parsedInput.opportunityId,
        userId,
      });
      if (!result.ok) {
        throw new ActionError(result.error.kind, result.error.message);
      }
      revalidatePath("/tickets");
      revalidatePath("/");
      return { status: null };
    }

    // ここでは `intent` は "remove" で早期 return 済みのため
    // "planned" | "applied" に narrow されている。
    const status = userTicketOpportunityStatusSchema.parse(parsedInput.intent);
    const result = await setMyTicketOpportunityState(ctx.supabase, {
      opportunityId: parsedInput.opportunityId,
      userId,
      status,
    });
    if (!result.ok) {
      throw new ActionError(result.error.kind, result.error.message);
    }
    revalidatePath("/tickets");
    revalidatePath("/");
    return { status };
  });
