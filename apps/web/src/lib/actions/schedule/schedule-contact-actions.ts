"use server";

import { authActionClient } from "@/lib/safe-action";
import {
  affectedReadSurfaces,
  revalidateReadSurfaces,
} from "@/lib/revalidation";
import {
  contactAliasInputSchema,
  contactEmailInputSchema,
  contactInputSchema,
  contactRequestInputSchema,
  contactShareInputSchema,
} from "./schedule-contact-schemas";
import {
  acceptScheduleContactRequest,
  cancelScheduleContactRequest,
  declineScheduleContactRequest,
  requestScheduleContact,
  setScheduleContactAlias,
  shareScheduleEntryWithContact,
  unlinkScheduleContact,
} from "./schedule-contact-write";

// Prepared actions only; existing routes/components do not import this module.
// Authentication uses the existing session client; authorization and generations
// remain in the DB. No owner, actor or raw recipient UUID is accepted as input.
export const requestScheduleContactAction = authActionClient
  .inputSchema(contactEmailInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await requestScheduleContact(ctx.supabase, parsedInput.recipientEmail);
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactWrite());
    return { ok: true as const };
  });
export const cancelScheduleContactRequestAction = authActionClient
  .inputSchema(contactEmailInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await cancelScheduleContactRequest(
      ctx.supabase,
      parsedInput.recipientEmail,
    );
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactWrite());
    return { ok: true as const };
  });
export const acceptScheduleContactRequestAction = authActionClient
  .inputSchema(contactRequestInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await acceptScheduleContactRequest(ctx.supabase, parsedInput.requestId);
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactWrite());
    return { ok: true as const };
  });
export const declineScheduleContactRequestAction = authActionClient
  .inputSchema(contactRequestInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await declineScheduleContactRequest(ctx.supabase, parsedInput.requestId);
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactWrite());
    return { ok: true as const };
  });
export const setScheduleContactAliasAction = authActionClient
  .inputSchema(contactAliasInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await setScheduleContactAlias(
      ctx.supabase,
      parsedInput.contactId,
      parsedInput.alias,
    );
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactWrite());
    return { ok: true as const };
  });
export const unlinkScheduleContactAction = authActionClient
  .inputSchema(contactInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await unlinkScheduleContact(ctx.supabase, parsedInput.contactId);
    revalidateReadSurfaces(affectedReadSurfaces.scheduleContactUnlink());
    return { ok: true as const };
  });
export const shareScheduleEntryWithContactAction = authActionClient
  .inputSchema(contactShareInputSchema)
  .action(async ({ parsedInput, ctx }) => {
    await shareScheduleEntryWithContact(
      ctx.supabase,
      parsedInput.entryId,
      parsedInput.contactId,
    );
    revalidateReadSurfaces(
      affectedReadSurfaces.scheduleShareWrite(parsedInput.entryId),
    );
    return { ok: true as const };
  });
