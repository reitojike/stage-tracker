import { z } from "zod";
import {
  personalScheduleEntryIdSchema,
  scheduleContactAliasInputSchema,
  scheduleContactEmailInputSchema,
  scheduleContactIdSchema,
  scheduleContactRequestIdSchema,
} from "@stage-tracker/domain";

export const contactEmailInputSchema = z.strictObject({
  recipientEmail: scheduleContactEmailInputSchema,
});
export const contactRequestInputSchema = z.strictObject({
  requestId: scheduleContactRequestIdSchema,
});
export const contactInputSchema = z.strictObject({
  contactId: scheduleContactIdSchema,
});
export const contactAliasInputSchema = z.strictObject({
  contactId: scheduleContactIdSchema,
  alias: scheduleContactAliasInputSchema,
});
export const contactShareInputSchema = z.strictObject({
  entryId: personalScheduleEntryIdSchema,
  contactId: scheduleContactIdSchema,
});
