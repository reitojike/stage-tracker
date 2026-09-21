import { z } from 'zod';

/**
 * Opaque, branded identifiers for the PersonalSchedule sub-domain
 * (`specs/007-personal-schedule-lifecycle/spec.md` "Event-independent personal schedule",
 * §1.8). Defined here rather than in the shared `../ids.ts` because this
 * Task's directory boundary excludes that file (owned by the parent Task,
 * which wires sub-domain ids into the shared barrel afterward) - see this
 * package's top-level `../ids.ts` for the sibling `UserId`/`EventId`/
 * `OccurrenceId` this sub-domain composes with.
 */

export const personalScheduleEntryIdSchema = z.uuid().brand<'PersonalScheduleEntryId'>();
export type PersonalScheduleEntryId = z.infer<typeof personalScheduleEntryIdSchema>;

export const scheduleShareIdSchema = z.uuid().brand<'ScheduleShareId'>();
export type ScheduleShareId = z.infer<typeof scheduleShareIdSchema>;
