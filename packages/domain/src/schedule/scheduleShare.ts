import { z } from 'zod';
import type { UserId } from '../ids';
import { userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { personalScheduleEntryIdSchema, scheduleShareIdSchema } from './ids';
import type { PersonalScheduleEntry } from './scheduleEntry';

/**
 * ScheduleShare: one recipient a PersonalScheduleEntry has been shared with
 * (AGENTS.md "Event-independent personal schedule" - "owner は entry 単位で
 * authenticated user を明示指定して共有できます"). Sharing has no approval
 * flow: a share row existing IS the (immediate) grant.
 *
 * This is a minimal, independent record on purpose - no per-share
 * visibility/blocking override field exists here, because none is part of
 * the product model (see personalScheduleEntryBlockingForViewer below).
 */
export const scheduleShareSchema = z.object({
  id: scheduleShareIdSchema,
  scheduleEntryId: personalScheduleEntryIdSchema,
  sharedWithUserId: userIdSchema,
  createdAt: instantSchema,
});

export type ScheduleShare = z.infer<typeof scheduleShareSchema>;

/**
 * Whether `userId` may see `entry`: the owner always can, and so can anyone
 * appearing in `shares` as a recipient (docs/v2/oracle-domain.md §1.8 "SELECT
 * policy は owner-or-shared として一括で許可される"). This mirrors the RLS
 * union at the domain level - the RLS policy itself remains the actual
 * enforcement boundary; this function is for callers (e.g. UI-side
 * filtering, tests) that need the same predicate without a DB round trip.
 */
export function canUserViewPersonalScheduleEntry(
  entry: Pick<PersonalScheduleEntry, 'ownerId'>,
  shares: readonly Pick<ScheduleShare, 'sharedWithUserId'>[],
  userId: UserId,
): boolean {
  if (entry.ownerId === userId) {
    return true;
  }
  return shares.some((share) => share.sharedWithUserId === userId);
}

/**
 * `blocking` is a property of the entry itself, never of the viewer
 * (AGENTS.md: "`blocking` は entry 本体の属性であり、share 先にも同じ
 * semantics で伝播する。per-recipient の blocking override は設けません").
 * This function is intentionally trivial - it exists to give that invariant
 * a single, testable call site: whichever viewer asks (owner or any
 * recipient), the answer is the same `entry.blocking` value, because this
 * package has no per-recipient override field to consult in the first
 * place. A caller must never introduce one by branching on `userId` here.
 */
export function personalScheduleEntryBlockingForViewer(
  entry: Pick<PersonalScheduleEntry, 'blocking'>,
): boolean {
  return entry.blocking;
}
