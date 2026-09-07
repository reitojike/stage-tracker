import { z } from 'zod';
import { userIdSchema } from '../ids';
import { compareInstants, instantSchema } from '../time/instant';
import { compareTokyoCalendarDates, tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';
import { personalScheduleEntryIdSchema } from './ids';

/**
 * PersonalScheduleEntry: an Event-independent personal schedule item
 * (AGENTS.md "Event-independent personal schedule", docs/v2/oracle-domain.md
 * §1.8). Unlike the superseded `paid_leave`/`work`/`travel`/`other` closed
 * vocabulary (Issue #121), an entry has no fixed category - only a required
 * free-form `title`.
 *
 * `temporal` is a discriminated union of exactly the two shapes the product
 * distinguishes:
 * - `all-day`: a whole-day or multi-day span of Asia/Tokyo calendar dates
 *   (`startsOn <= endsOn`; a single day is `startsOn === endsOn`).
 * - `time-bounded`: an absolute start instant with a nullable end instant.
 *   A missing `endsAt` is a valid "end time not yet known" state and must
 *   never be defaulted to "ends same day"/"ends now" - see this schema's
 *   deliberate absence of any such fallback.
 *
 * Modeling this as a discriminated union (rather than four nullable sibling
 * columns, which is how the underlying `personal_schedule_entries` table
 * stores it - see docs/v2/oracle-database.md §1.4's `is_all_day`/
 * `starts_on`/`ends_on`/`starts_at`/`ends_at`) makes "exactly one temporal
 * shape, never a mix" a property the type system enforces, not just a CHECK
 * constraint callers must remember to respect.
 */

const scheduleEntryAllDayTemporalSchema = z.object({
  kind: z.literal('all-day'),
  startsOn: tokyoCalendarDateSchema,
  endsOn: tokyoCalendarDateSchema,
});

const scheduleEntryTimeBoundedTemporalSchema = z.object({
  kind: z.literal('time-bounded'),
  startsAt: instantSchema,
  endsAt: instantSchema.nullable(),
});

export const personalScheduleEntryTemporalSchema = z
  .discriminatedUnion('kind', [
    scheduleEntryAllDayTemporalSchema,
    scheduleEntryTimeBoundedTemporalSchema,
  ])
  .superRefine((temporal, ctx) => {
    if (temporal.kind === 'all-day') {
      if (compareTokyoCalendarDates(temporal.startsOn, temporal.endsOn) > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsOn'],
          message: 'endsOn must be on or after startsOn.',
        });
      }
      return;
    }
    if (temporal.endsAt !== null && compareInstants(temporal.startsAt, temporal.endsAt) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'startsAt must be on or before endsAt.',
      });
    }
  });

export type PersonalScheduleEntryTemporal = z.infer<typeof personalScheduleEntryTemporalSchema>;

/**
 * `blocking` is documented separately from `temporal` on purpose: it is an
 * independent attribute of the entry (AGENTS.md "各 entry は独立した
 * blocking boolean を持ちます"), not derived from the temporal shape - an
 * all-day entry can be non-blocking (e.g. a reminder) and a time-bounded
 * entry can be blocking.
 */
export const personalScheduleEntrySchema = z.object({
  id: personalScheduleEntryIdSchema,
  ownerId: userIdSchema,
  title: z.string().min(1),
  memo: z.string().nullable(),
  blocking: z.boolean(),
  temporal: personalScheduleEntryTemporalSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export type PersonalScheduleEntry = z.infer<typeof personalScheduleEntrySchema>;
