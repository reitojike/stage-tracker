import { z } from 'zod';
import { instantSchema } from '../time/instant';
import { scheduleContactIdSchema, scheduleContactRequestIdSchema } from './ids';

// Issue #825: prepared contracts only; the database release gate remains false.
// A contact id names one acceptance generation, not a reusable user/pair id.
export const scheduleContactEmailInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .pipe(z.email());
const aliasLength = (value: string) => Array.from(value).length <= 80 && !value.includes('\0');
export const scheduleContactAliasInputSchema = z
  .string()
  .trim()
  .refine(aliasLength)
  .transform((value) => (value === '' ? null : value))
  .nullable();
const aliasSchema = z
  .string()
  .min(1)
  // PostgreSQL btrim(text) removes ordinary spaces, not every JS whitespace.
  .refine((value) => value === value.replace(/^ +| +$/gu, '') && aliasLength(value));

export const scheduleContactSchema = z.object({
  contactId: scheduleContactIdSchema,
  counterpartEmail: z.email().max(320),
  ownAlias: aliasSchema.nullable(),
  acceptedAt: instantSchema,
});
export type ScheduleContact = z.infer<typeof scheduleContactSchema>;

export const receivedScheduleContactRequestSchema = z.object({
  requestId: scheduleContactRequestIdSchema,
  requesterEmail: z.email().max(320),
  requestedAt: instantSchema,
});
export type ReceivedScheduleContactRequest = z.infer<typeof receivedScheduleContactRequestSchema>;
