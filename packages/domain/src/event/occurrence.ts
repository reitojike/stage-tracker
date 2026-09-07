import { z } from 'zod';
import { eventIdSchema, occurrenceIdSchema } from '../ids';
import { compareInstants, instantSchema } from '../time/instant';

/**
 * Occurrence ("公演回"): one performance belonging to an Event
 * (docs/v2/oracle-domain.md §1.2). `doorsAt`/`endsAt` are nullable - an
 * unknown door/end time is a valid state, never defaulted.
 *
 * Enforces the ordering invariant `doorsAt <= startsAt <= endsAt`
 * (AGENTS.md "開場 / 開演 / 終演"), comparing only the fields that are
 * actually set: a null field is not compared, per the same product rule.
 *
 * This schema does NOT enforce "occurrence's startsAt falls within the
 * parent Event's range" or "unique startsAt per Event" - both require the
 * parent Event/sibling Occurrences as context and live in
 * ./eventOccurrenceInvariants.ts instead.
 */
export const occurrenceSchema = z
  .object({
    id: occurrenceIdSchema,
    eventId: eventIdSchema,
    doorsAt: instantSchema.nullable(),
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    canceledAt: instantSchema.nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .superRefine((occurrence, ctx) => {
    if (
      occurrence.doorsAt !== null &&
      compareInstants(occurrence.doorsAt, occurrence.startsAt) > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['doorsAt'],
        message: 'doorsAt must be on or before startsAt.',
      });
    }
    if (occurrence.endsAt !== null && compareInstants(occurrence.startsAt, occurrence.endsAt) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'startsAt must be on or before endsAt.',
      });
    }
  });

export type Occurrence = z.infer<typeof occurrenceSchema>;
