import { describe, expect, it } from 'vitest';
import { eventIdSchema, occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { ticketOpportunityIdSchema, userTicketOpportunityStateIdSchema } from './ids';
import {
  ticketOpportunitySchema,
  ticketOpportunityWithTargetsSchema,
  userTicketOpportunityStateSchema,
} from './ticketOpportunity';

const opportunityId = ticketOpportunityIdSchema.parse('11111111-1111-4111-8111-111111111111');
const eventId = eventIdSchema.parse('22222222-2222-4222-8222-222222222222');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function baseOpportunity(overrides: Partial<{ targetScope: string }> = {}) {
  return {
    id: opportunityId,
    eventId,
    targetScope: overrides.targetScope ?? 'event_wide',
    displayName: 'FC先行',
    sourceKey: 'fc-presale-1',
    sourceUrl: null,
    memo: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('ticketOpportunitySchema', () => {
  it('accepts a well-formed event_wide opportunity', () => {
    const result = ticketOpportunitySchema.safeParse(baseOpportunity());
    expect(result.success).toBe(true);
  });

  it('preserves the source display name verbatim (no closed-enum normalization)', () => {
    const parsed = ticketOpportunitySchema.parse({
      ...baseOpportunity(),
      displayName: '宝塚友の会 第1抽選',
    });
    expect(parsed.displayName).toBe('宝塚友の会 第1抽選');
  });

  it('rejects an empty displayName', () => {
    const result = ticketOpportunitySchema.safeParse({ ...baseOpportunity(), displayName: '' });
    expect(result.success).toBe(false);
  });

  it('rejects an unrecognized targetScope', () => {
    const result = ticketOpportunitySchema.safeParse({
      ...baseOpportunity(),
      targetScope: 'whole_run',
    });
    expect(result.success).toBe(false);
  });
});

describe('ticketOpportunityWithTargetsSchema - event_wide never carries occurrence ids', () => {
  it('accepts event_wide with an empty target list', () => {
    const result = ticketOpportunityWithTargetsSchema.safeParse({
      opportunity: baseOpportunity({ targetScope: 'event_wide' }),
      targetOccurrenceIds: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects event_wide carrying a non-empty target list - the semantic fact is never snapshotted into an occurrence list', () => {
    const occurrenceId = occurrenceIdSchema.parse('33333333-3333-4333-8333-333333333333');
    const result = ticketOpportunityWithTargetsSchema.safeParse({
      opportunity: baseOpportunity({ targetScope: 'event_wide' }),
      targetOccurrenceIds: [occurrenceId],
    });
    expect(result.success).toBe(false);
  });
});

describe('ticketOpportunityWithTargetsSchema - selected_occurrences', () => {
  const occurrenceId = occurrenceIdSchema.parse('33333333-3333-4333-8333-333333333333');

  it('accepts selected_occurrences with at least one target', () => {
    const result = ticketOpportunityWithTargetsSchema.safeParse({
      opportunity: baseOpportunity({ targetScope: 'selected_occurrences' }),
      targetOccurrenceIds: [occurrenceId],
    });
    expect(result.success).toBe(true);
  });

  it('accepts selected_occurrences targeting multiple occurrences', () => {
    const secondOccurrenceId = occurrenceIdSchema.parse('44444444-4444-4444-8444-444444444444');
    const result = ticketOpportunityWithTargetsSchema.safeParse({
      opportunity: baseOpportunity({ targetScope: 'selected_occurrences' }),
      targetOccurrenceIds: [occurrenceId, secondOccurrenceId],
    });
    expect(result.success).toBe(true);
  });

  it('rejects selected_occurrences with zero targets', () => {
    const result = ticketOpportunityWithTargetsSchema.safeParse({
      opportunity: baseOpportunity({ targetScope: 'selected_occurrences' }),
      targetOccurrenceIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('userTicketOpportunityStateSchema', () => {
  const userId = userIdSchema.parse('55555555-5555-4555-8555-555555555555');
  const stateId = userTicketOpportunityStateIdSchema.parse('66666666-6666-4666-8666-666666666666');

  it('accepts status: planned', () => {
    const result = userTicketOpportunityStateSchema.safeParse({
      id: stateId,
      userId,
      opportunityId,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.success).toBe(true);
  });

  it('accepts status: applied', () => {
    const result = userTicketOpportunityStateSchema.safeParse({
      id: stateId,
      userId,
      opportunityId,
      status: 'applied',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a status outside planned/applied (e.g. a would-be detailed application status)', () => {
    const result = userTicketOpportunityStateSchema.safeParse({
      id: stateId,
      userId,
      opportunityId,
      status: 'won',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.success).toBe(false);
  });
});
