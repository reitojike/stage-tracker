import { describe, expect, it } from 'vitest';
import { instantSchema } from '../time/instant';
import {
  isTicketOpportunityEffectivelyCanceled,
  type TicketOpportunityCancellationScope,
} from './ticketOpportunityCancellation';

const canceledAt = instantSchema.parse('2026-01-01T00:00:00Z');

function scope(
  overrides: Partial<TicketOpportunityCancellationScope>,
): TicketOpportunityCancellationScope {
  return {
    eventCanceled: false,
    targetScope: 'event_wide',
    resolvedTargetOccurrences: [],
    targetOccurrenceIdCount: 0,
    ...overrides,
  };
}

describe('isTicketOpportunityEffectivelyCanceled - rule 1: event cancellation is always terminal', () => {
  it('is terminal when the parent Event is canceled, regardless of targetScope', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({ eventCanceled: true, targetScope: 'event_wide' }),
      ),
    ).toBe(true);
  });

  it('is terminal for a canceled Event even with selected_occurrences targets, none canceled', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({
          eventCanceled: true,
          targetScope: 'selected_occurrences',
          resolvedTargetOccurrences: [{ canceledAt: null }],
          targetOccurrenceIdCount: 1,
        }),
      ),
    ).toBe(true);
  });
});

describe('isTicketOpportunityEffectivelyCanceled - rule 2: event_wide is a semantic fact, never a snapshot', () => {
  it('is never terminal for event_wide when the Event is not canceled', () => {
    expect(isTicketOpportunityEffectivelyCanceled(scope({ targetScope: 'event_wide' }))).toBe(
      false,
    );
  });
});

describe('isTicketOpportunityEffectivelyCanceled - rule 3: selected_occurrences requires complete, non-empty, all-canceled resolution', () => {
  it('is terminal when every resolved target is canceled and resolution is complete', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({
          targetScope: 'selected_occurrences',
          resolvedTargetOccurrences: [{ canceledAt }, { canceledAt }],
          targetOccurrenceIdCount: 2,
        }),
      ),
    ).toBe(true);
  });

  it('is not terminal when only some resolved targets are canceled (partial cancellation)', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({
          targetScope: 'selected_occurrences',
          resolvedTargetOccurrences: [{ canceledAt }, { canceledAt: null }],
          targetOccurrenceIdCount: 2,
        }),
      ),
    ).toBe(false);
  });

  it('is not terminal when the resolved set is empty', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({
          targetScope: 'selected_occurrences',
          resolvedTargetOccurrences: [],
          targetOccurrenceIdCount: 0,
        }),
      ),
    ).toBe(false);
  });

  it('is not terminal when resolution is incomplete, even though every resolved target is canceled (must not misread a partial resolution as "all canceled")', () => {
    expect(
      isTicketOpportunityEffectivelyCanceled(
        scope({
          targetScope: 'selected_occurrences',
          resolvedTargetOccurrences: [{ canceledAt }],
          targetOccurrenceIdCount: 3,
        }),
      ),
    ).toBe(false);
  });
});
