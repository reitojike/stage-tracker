import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapTicketOpportunityMilestoneRow,
  mapTicketOpportunityRow,
  mapUserTicketOpportunityStateRow,
  sortTicketOpportunitiesByCreatedAt,
  sortTicketOpportunityMilestonesChronologically,
  ticketOpportunityMilestoneSortInstant,
} from '../ticketOpportunity.ts';

void test('mapTicketOpportunityRow maps a shared row', () => {
  const opportunity = mapTicketOpportunityRow({
    id: 'opp-1',
    event_id: 'event-1',
    target_scope: 'selected_occurrences',
    display_name: '第1抽選',
    source_key: 'takarazuka:2026:first-lottery',
    source_url: 'https://example.test/schedule',
    memo: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(opportunity.targetScope, 'selected_occurrences');
  assert.equal(opportunity.displayName, '第1抽選');
  assert.equal(opportunity.sourceKey, 'takarazuka:2026:first-lottery');
});

void test('mapTicketOpportunityRow rejects an unrecognized target_scope', () => {
  assert.throws(() =>
    mapTicketOpportunityRow({
      id: 'opp-1',
      event_id: 'event-1',
      target_scope: 'everything',
      display_name: '第1抽選',
      source_key: 'k',
      source_url: null,
      memo: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }),
  );
});

void test('mapTicketOpportunityMilestoneRow maps a date-precision milestone', () => {
  const milestone = mapTicketOpportunityMilestoneRow({
    id: 'ms-1',
    opportunity_id: 'opp-1',
    milestone_type: 'application_open',
    temporal_precision: 'date',
    date_value: '2026-09-01',
    at: null,
    starts_at: null,
    ends_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(milestone.temporalPrecision, 'date');
  assert.equal(milestone.dateValue, '2026-09-01');
  assert.equal(milestone.at, null);
});

void test('mapTicketOpportunityMilestoneRow rejects an unrecognized milestone_type', () => {
  assert.throws(() =>
    mapTicketOpportunityMilestoneRow({
      id: 'ms-1',
      opportunity_id: 'opp-1',
      milestone_type: 'unknown_phase',
      temporal_precision: 'date',
      date_value: '2026-09-01',
      at: null,
      starts_at: null,
      ends_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }),
  );
});

void test('mapTicketOpportunityMilestoneRow rejects an unrecognized temporal_precision', () => {
  assert.throws(() =>
    mapTicketOpportunityMilestoneRow({
      id: 'ms-1',
      opportunity_id: 'opp-1',
      milestone_type: 'application_open',
      temporal_precision: 'fuzzy',
      date_value: null,
      at: null,
      starts_at: null,
      ends_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }),
  );
});

void test('mapUserTicketOpportunityStateRow rejects an out-of-vocabulary status', () => {
  assert.throws(() =>
    mapUserTicketOpportunityStateRow({
      id: 'state-1',
      user_id: 'user-1',
      opportunity_id: 'opp-1',
      status: 'secured',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    }),
  );
});

void test('mapUserTicketOpportunityStateRow maps planned/applied', () => {
  const state = mapUserTicketOpportunityStateRow({
    id: 'state-1',
    user_id: 'user-1',
    opportunity_id: 'opp-1',
    status: 'planned',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(state.status, 'planned');
});

function milestone(overrides: Partial<Parameters<typeof mapTicketOpportunityMilestoneRow>[0]>) {
  return mapTicketOpportunityMilestoneRow({
    id: 'ms-default',
    opportunity_id: 'opp-1',
    milestone_type: 'application_open',
    temporal_precision: 'date',
    date_value: '2026-09-01',
    at: null,
    starts_at: null,
    ends_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  });
}

void test('ticketOpportunityMilestoneSortInstant prefers at, then starts_at, then date_value', () => {
  assert.equal(
    ticketOpportunityMilestoneSortInstant(
      milestone({
        id: 'a',
        milestone_type: 'sale_start',
        temporal_precision: 'datetime',
        date_value: null,
        at: '2026-09-10T01:00:00.000Z',
      }),
    ),
    '2026-09-10T01:00:00.000Z',
  );
  assert.equal(
    ticketOpportunityMilestoneSortInstant(
      milestone({
        id: 'b',
        milestone_type: 'payment_window',
        temporal_precision: 'window',
        date_value: null,
        starts_at: '2026-08-10T09:00:00.000Z',
        ends_at: '2026-08-13T14:59:00.000Z',
      }),
    ),
    '2026-08-10T09:00:00.000Z',
  );
  assert.equal(
    ticketOpportunityMilestoneSortInstant(milestone({ id: 'c', date_value: '2026-09-01' })),
    '2026-09-01T00:00:00.000Z',
  );
});

void test('sortTicketOpportunityMilestonesChronologically orders across mixed precisions', () => {
  const dateOnly = milestone({
    id: 'ms-a',
    milestone_type: 'application_open',
    temporal_precision: 'date',
    date_value: '2026-09-01',
  });
  const window = milestone({
    id: 'ms-b',
    milestone_type: 'payment_window',
    temporal_precision: 'window',
    date_value: null,
    starts_at: '2026-08-10T09:00:00.000Z',
    ends_at: '2026-08-13T14:59:00.000Z',
  });
  const exact = milestone({
    id: 'ms-c',
    milestone_type: 'sale_start',
    temporal_precision: 'datetime',
    date_value: null,
    at: '2026-09-10T01:00:00.000Z',
  });

  const sorted = sortTicketOpportunityMilestonesChronologically([exact, dateOnly, window]);
  assert.deepEqual(
    sorted.map((m) => m.id),
    ['ms-b', 'ms-a', 'ms-c'],
  );
});

void test('sortTicketOpportunitiesByCreatedAt orders by createdAt then id', () => {
  const older = mapTicketOpportunityRow({
    id: 'opp-b',
    event_id: 'event-1',
    target_scope: 'event_wide',
    display_name: 'A',
    source_key: 'k1',
    source_url: null,
    memo: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  });
  const newer = mapTicketOpportunityRow({
    id: 'opp-a',
    event_id: 'event-1',
    target_scope: 'event_wide',
    display_name: 'B',
    source_key: 'k2',
    source_url: null,
    memo: null,
    created_at: '2026-08-02T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
  });
  const sorted = sortTicketOpportunitiesByCreatedAt([newer, older]);
  assert.deepEqual(
    sorted.map((o) => o.id),
    ['opp-b', 'opp-a'],
  );
});
