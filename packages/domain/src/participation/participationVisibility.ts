import type { UserId } from '../ids';
import type { Participation } from './participation';

/**
 * SELECT visibility for a Participation row (see
 * specs/001-occurrence-participation/spec.md: FR-022–FR-024; migration-era DB
 * context is in the current schema/RLS contract): visible to its
 * own user, or to anyone when `visibility` is `public`.
 *
 * Deliberately takes only `userId`/`visibility` as input - not, say, an
 * `isEventOwner` flag - because being the Event owner grants no read access
 * to another user's private Participation (the current Participation privacy
 * "event owner でさえ他人の private participation を読めないこと"). A
 * caller cannot accidentally widen visibility just by having more context
 * available, because this function has no parameter to carry that context
 * in.
 */
export function isParticipationVisibleTo(
  participation: Pick<Participation, 'userId' | 'visibility'>,
  viewerId: UserId,
): boolean {
  return participation.userId === viewerId || participation.visibility === 'public';
}
