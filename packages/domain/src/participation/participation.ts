import { z } from 'zod';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';

/**
 * Participation ("参加予定"): a per-Occurrence, per-user intention to attend
 * (docs/v2/oracle-domain.md §1.6, AGENTS.md "Participation").
 *
 * `ParticipationId` is defined locally rather than in `../ids` per this
 * task's instructions (the parent package wires new id types into the shared
 * module later).
 */
export const participationIdSchema = z.uuid().brand<'ParticipationId'>();
export type ParticipationId = z.infer<typeof participationIdSchema>;

/**
 * MVP status vocabulary is exactly these two values. `not_attending` is
 * intentionally absent - "not attending" is represented by the *absence* of
 * a Participation row, never persisted as a status value (AGENTS.md
 * "Participation": "行が存在しないことと `not_attending` を別々に二重化
 * しません"; docs/v2/oracle-database.md §5 invariant 7).
 */
export const participationStatusSchema = z.enum(['considering', 'attending']);
export type ParticipationStatus = z.infer<typeof participationStatusSchema>;

/**
 * `private` = the user themself only, `public` = every authenticated user
 * (AGENTS.md "Participation"). The default is `private`
 * (`DEFAULT_PARTICIPATION_VISIBILITY`) for callers building a new
 * Participation write that did not specify one explicitly.
 */
export const participationVisibilitySchema = z.enum(['private', 'public']);
export type ParticipationVisibility = z.infer<typeof participationVisibilitySchema>;
export const DEFAULT_PARTICIPATION_VISIBILITY: ParticipationVisibility = 'private';

/**
 * Participation is scoped to an Occurrence, never an Event
 * (docs/v2/oracle-domain.md §1.6: "定義: occurrence 単位の... event 単位の
 * participation は存在しない"). There is deliberately no `eventId` field -
 * adding one would make "which Occurrence(s) does this apply to" ambiguous.
 */
export const participationSchema = z.object({
  id: participationIdSchema,
  occurrenceId: occurrenceIdSchema,
  userId: userIdSchema,
  status: participationStatusSchema,
  visibility: participationVisibilitySchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
});
export type Participation = z.infer<typeof participationSchema>;
