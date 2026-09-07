import { describe, expect, it } from 'vitest';
import { eventIdSchema, occurrenceIdSchema } from '../ids';
import { ticketOpportunityMilestoneIdSchema } from './ids';
import {
  findTicketOpportunityInvariantViolations,
  isTicketOpportunityTargetOccurrenceValid,
} from './ticketOpportunityInvariants';

const eventId = eventIdSchema.parse('11111111-1111-4111-8111-111111111111');
const otherEventId = eventIdSchema.parse('22222222-2222-4222-8222-222222222222');

function occId(n: number) {
  return occurrenceIdSchema.parse(`00000000-0000-4000-8000-00000000000${String(n)}`);
}

function milestoneId(n: number) {
  return ticketOpportunityMilestoneIdSchema.parse(
    `10000000-0000-4000-8000-00000000000${String(n)}`,
  );
}

describe('isTicketOpportunityTargetOccurrenceValid', () => {
  it('is true when the target occurrence belongs to the same event', () => {
    expect(isTicketOpportunityTargetOccurrenceValid(eventId, eventId)).toBe(true);
  });

  it('is false when the target occurrence belongs to a different event', () => {
    expect(isTicketOpportunityTargetOccurrenceValid(eventId, otherEventId)).toBe(false);
  });
});

describe('findTicketOpportunityInvariantViolations - target occurrence event membership', () => {
  it("reports no violation when every target occurrence belongs to the opportunity's event", () => {
    const violations = findTicketOpportunityInvariantViolations(
      eventId,
      [
        { id: occId(1), eventId },
        { id: occId(2), eventId },
      ],
      [],
    );
    expect(violations).toEqual([]);
  });

  it('flags a target occurrence belonging to a different event', () => {
    const violations = findTicketOpportunityInvariantViolations(
      eventId,
      [{ id: occId(1), eventId: otherEventId }],
      [],
    );
    expect(violations).toEqual([
      { kind: 'target-occurrence-outside-event', occurrenceId: occId(1) },
    ]);
  });
});

describe('findTicketOpportunityInvariantViolations - milestone type uniqueness', () => {
  it('reports no violation for distinct milestone types', () => {
    const violations = findTicketOpportunityInvariantViolations(
      eventId,
      [],
      [
        { id: milestoneId(1), milestoneType: 'application_open' },
        { id: milestoneId(2), milestoneType: 'application_close' },
      ],
    );
    expect(violations).toEqual([]);
  });

  it('flags two milestones sharing the same milestoneType', () => {
    const violations = findTicketOpportunityInvariantViolations(
      eventId,
      [],
      [
        { id: milestoneId(1), milestoneType: 'application_close' },
        { id: milestoneId(2), milestoneType: 'application_close' },
      ],
    );
    expect(violations).toEqual([
      {
        kind: 'duplicate-milestone-type',
        milestoneType: 'application_close',
        milestoneIds: [milestoneId(1), milestoneId(2)],
      },
    ]);
  });

  it('reports both kinds of violation together when both apply', () => {
    const violations = findTicketOpportunityInvariantViolations(
      eventId,
      [{ id: occId(1), eventId: otherEventId }],
      [
        { id: milestoneId(1), milestoneType: 'sale_start' },
        { id: milestoneId(2), milestoneType: 'sale_start' },
      ],
    );
    expect(violations.filter((v) => v.kind === 'target-occurrence-outside-event')).toHaveLength(1);
    expect(violations.filter((v) => v.kind === 'duplicate-milestone-type')).toHaveLength(1);
  });

  it('reports no violations for an opportunity with zero milestones and zero targets', () => {
    expect(findTicketOpportunityInvariantViolations(eventId, [], [])).toEqual([]);
  });
});
