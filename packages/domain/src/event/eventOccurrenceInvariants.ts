import type { OccurrenceId } from '../ids';
import { compareInstants, type Instant } from '../time/instant';
import { instantToTokyoCalendarDate } from '../time/tokyoConversion';
import {
  isTokyoCalendarDateWithinRange,
  type TokyoCalendarDateRange,
} from '../time/tokyoCalendarDate';
import type { Occurrence } from './occurrence';

/**
 * Cross-entity invariants between an Event and its Occurrences
 * (docs/v2/oracle-domain.md §2.2). These cannot live on `occurrenceSchema`
 * alone because they need the parent Event's range and/or sibling
 * Occurrences as context.
 */

/**
 * The Event range containment invariant compares the Occurrence's `startsAt`
 * *Tokyo calendar date* against the Event range - `doorsAt`/`endsAt` are
 * never consulted here, even if they fall on a different calendar day
 * (AGENTS.md "開催期間（Event range）": "開場日時（doors 相当）や終演日時
 * （ends_at）が日付をまたいでも、それらは range 判定の対象に含めません").
 */
export function isOccurrenceStartWithinEventRange(
  startsAt: Instant,
  eventRange: TokyoCalendarDateRange,
): boolean {
  return isTokyoCalendarDateWithinRange(instantToTokyoCalendarDate(startsAt), eventRange);
}

export type EventOccurrenceInvariantViolation =
  | {
      readonly kind: 'occurrence-outside-event-range';
      readonly occurrenceId: OccurrenceId;
      readonly startsAt: Instant;
    }
  | {
      readonly kind: 'duplicate-occurrence-start';
      /** All Occurrences sharing this `startsAt` instant (length >= 2). */
      readonly occurrenceIds: readonly OccurrenceId[];
      readonly startsAt: Instant;
    };

/**
 * Validates a full Event + Occurrence-set aggregate (e.g. before submitting a
 * `reschedule_event`-style atomic update, docs/v2/oracle-domain.md §2.6)
 * against both cross-entity invariants:
 *
 * - every Occurrence's `startsAt` Tokyo calendar date falls within the
 *   Event's range;
 * - no two Occurrences in the set share the same `startsAt` *instant*
 *   (docs/v2/oracle-domain.md §2.2: "同一 Event 内で Occurrence の startsAt
 *   instant は一意（壁時計表記の一意性ではない）") - duplicates are detected
 *   by comparing the underlying instant (via `compareInstants`), not by
 *   comparing the raw wire strings, so two Occurrences whose `startsAt`
 *   strings differ but denote the same instant (e.g. one written with a "Z"
 *   suffix and the other with an equivalent "+09:00" offset) are still
 *   flagged as duplicates, and two Occurrences that happen to share the same
 *   *wall-clock* text in different offsets are not falsely flagged.
 *
 * Returns every violation found (not just the first), so a caller can report
 * all problems in one pass.
 */
export function findEventOccurrenceInvariantViolations(
  eventRange: TokyoCalendarDateRange,
  occurrences: readonly Pick<Occurrence, 'id' | 'startsAt'>[],
): EventOccurrenceInvariantViolation[] {
  const violations: EventOccurrenceInvariantViolation[] = [];

  for (const occurrence of occurrences) {
    if (!isOccurrenceStartWithinEventRange(occurrence.startsAt, eventRange)) {
      violations.push({
        kind: 'occurrence-outside-event-range',
        occurrenceId: occurrence.id,
        startsAt: occurrence.startsAt,
      });
    }
  }

  const groups: { startsAt: Instant; occurrenceIds: OccurrenceId[] }[] = [];
  for (const occurrence of occurrences) {
    const existingGroup = groups.find(
      (group) => compareInstants(group.startsAt, occurrence.startsAt) === 0,
    );
    if (existingGroup === undefined) {
      groups.push({ startsAt: occurrence.startsAt, occurrenceIds: [occurrence.id] });
    } else {
      existingGroup.occurrenceIds.push(occurrence.id);
    }
  }
  for (const group of groups) {
    if (group.occurrenceIds.length > 1) {
      violations.push({
        kind: 'duplicate-occurrence-start',
        occurrenceIds: group.occurrenceIds,
        startsAt: group.startsAt,
      });
    }
  }

  return violations;
}
