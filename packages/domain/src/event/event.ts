import { z } from 'zod';
import { eventIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { compareTokyoCalendarDates, tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';

/**
 * The Event range ("公演期間"): a required, inclusive-both-ends Asia/Tokyo
 * calendar date range (`specs/005-event-occurrence-lifecycle/spec.md` "Event 開催
 * 期間 (Event range)"). This is first-class Event data, not derived from its
 * Occurrences - an Event may have zero Occurrences while its range is known.
 */
export const eventRangeSchema = z
  .object({
    startsOn: tokyoCalendarDateSchema,
    endsOn: tokyoCalendarDateSchema,
  })
  .superRefine((range, ctx) => {
    if (compareTokyoCalendarDates(range.startsOn, range.endsOn) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'endsOn must be on or after startsOn.',
      });
    }
  });

export type EventRange = z.infer<typeof eventRangeSchema>;

/**
 * Event: the shared catalog entry for a production/engagement
 * (`specs/005-event-occurrence-lifecycle/spec.md`). `venue`/`sourceUrl`/`memo` are free-form
 * nullable text - this schema does not constrain their content beyond
 * nullability, so this schema does not invent length/format constraints for
 * them (the schema intentionally adds no length/format constraint).
 */
export const eventSchema = z
  .object({
    id: eventIdSchema,
    ownerId: userIdSchema,
    title: z.string().min(1),
    venue: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    memo: z.string().nullable(),
    startsOn: tokyoCalendarDateSchema,
    endsOn: tokyoCalendarDateSchema,
    canceledAt: instantSchema.nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .superRefine((event, ctx) => {
    if (compareTokyoCalendarDates(event.startsOn, event.endsOn) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'endsOn must be on or after startsOn.',
      });
    }
  });

export type Event = z.infer<typeof eventSchema>;
