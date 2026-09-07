import { describe, expect, it } from 'vitest';
import { instantSchema } from '../time/instant';
import { ticketOpportunityIdSchema, ticketOpportunityMilestoneIdSchema } from './ids';
import { ticketOpportunityMilestoneSchema } from './ticketOpportunityMilestone';

const milestoneId = ticketOpportunityMilestoneIdSchema.parse(
  '11111111-1111-4111-8111-111111111111',
);
const opportunityId = ticketOpportunityIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function common() {
  return { id: milestoneId, opportunityId, createdAt: now, updatedAt: now };
}

describe('ticketOpportunityMilestoneSchema - date precision', () => {
  it('accepts a bare date with no time information', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'application_close',
      temporalPrecision: 'date',
      dateValue: '2026-03-10',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.temporalPrecision === 'date') {
      // Never fabricates a time - the parsed shape carries only dateValue,
      // no `at`/`startsAt`/`endsAt` sibling field exists on this variant at
      // all (enforced by the type, not just left null at runtime).
      expect(result.data.dateValue).toBe('2026-03-10');
      expect(Object.keys(result.data)).not.toContain('at');
    }
  });

  it('rejects an invalid calendar date', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'application_close',
      temporalPrecision: 'date',
      dateValue: '2026-02-30',
    });
    expect(result.success).toBe(false);
  });
});

describe('ticketOpportunityMilestoneSchema - datetime precision', () => {
  it('accepts an exact instant', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'sale_start',
      temporalPrecision: 'datetime',
      at: '2026-03-10T10:00:00Z',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.temporalPrecision === 'datetime') {
      expect(result.data.at).toBe('2026-03-10T10:00:00.000Z');
    }
  });
});

describe('ticketOpportunityMilestoneSchema - window precision', () => {
  it('accepts startsAt strictly before endsAt', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'payment_window',
      temporalPrecision: 'window',
      startsAt: '2026-03-10T00:00:00Z',
      endsAt: '2026-03-15T23:59:59Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts startsAt === endsAt (boundary)', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'payment_window',
      temporalPrecision: 'window',
      startsAt: '2026-03-10T00:00:00Z',
      endsAt: '2026-03-10T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects endsAt before startsAt', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'payment_window',
      temporalPrecision: 'window',
      startsAt: '2026-03-15T00:00:00Z',
      endsAt: '2026-03-10T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('ticketOpportunityMilestoneSchema - milestone vocabulary', () => {
  it('accepts every documented milestone type', () => {
    const types = [
      'application_open',
      'application_close',
      'result_announcement',
      'sale_start',
      'payment_window',
    ];
    for (const milestoneType of types) {
      const result = ticketOpportunityMilestoneSchema.safeParse({
        ...common(),
        milestoneType,
        temporalPrecision: 'date',
        dateValue: '2026-03-10',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unrecognized milestone type', () => {
    const result = ticketOpportunityMilestoneSchema.safeParse({
      ...common(),
      milestoneType: 'seat_selection',
      temporalPrecision: 'date',
      dateValue: '2026-03-10',
    });
    expect(result.success).toBe(false);
  });
});
