import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
} from '../ticketOpportunityTimeline.ts';
import type { EventCatalogEvent, EventOccurrence } from '../eventCatalog.ts';
import type {
  TicketOpportunity,
  TicketOpportunityMilestone,
  TicketOpportunityWithDetails,
  UserTicketOpportunityState,
} from '../ticketOpportunity.ts';

function event(overrides: Partial<EventCatalogEvent> = {}): EventCatalogEvent {
  return {
    id: 'event-1',
    ownerId: 'owner-1',
    title: 'イベントA',
    venue: '会場A',
    sourceUrl: null,
    memo: null,
    startsOn: '2026-09-01',
    endsOn: '2026-09-30',
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: 'occ-1',
    eventId: 'event-1',
    doorsAt: null,
    startsAt: '2026-09-10T02:00:00.000Z',
    endsAt: null,
    canceledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function opportunity(overrides: Partial<TicketOpportunity> = {}): TicketOpportunity {
  return {
    id: 'opp-1',
    eventId: 'event-1',
    targetScope: 'event_wide',
    displayName: '第1抽選',
    sourceKey: 'source-key-1',
    sourceUrl: null,
    memo: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function milestone(
  overrides: Partial<TicketOpportunityMilestone> = {},
): TicketOpportunityMilestone {
  return {
    id: 'ms-1',
    opportunityId: 'opp-1',
    milestoneType: 'application_open',
    temporalPrecision: 'date',
    dateValue: '2026-09-01',
    at: null,
    startsAt: null,
    endsAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function myState(overrides: Partial<UserTicketOpportunityState> = {}): UserTicketOpportunityState {
  return {
    id: 'state-1',
    userId: 'user-1',
    opportunityId: 'opp-1',
    status: 'planned',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

void test('buildTicketOpportunityTimelineRows flattens one row per milestone, chronologically', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1', displayName: '第1抽選' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-open',
          opportunityId: 'opp-1',
          milestoneType: 'application_open',
          dateValue: '2026-09-01',
        }),
        milestone({
          id: 'ms-close',
          opportunityId: 'opp-1',
          milestoneType: 'application_close',
          dateValue: '2026-09-05',
        }),
        milestone({
          id: 'ms-result',
          opportunityId: 'opp-1',
          milestoneType: 'result_announcement',
          dateValue: '2026-09-10',
        }),
      ],
      myState: myState({ opportunityId: 'opp-1', status: 'planned' }),
    },
    {
      opportunity: opportunity({ id: 'opp-2', displayName: '一般発売' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-sale',
          opportunityId: 'opp-2',
          milestoneType: 'sale_start',
          dateValue: '2026-09-03',
        }),
      ],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ['ms-open', 'ms-sale', 'ms-close', 'ms-result'],
    'rows across opportunities interleave in chronological order, not grouped by opportunity or type',
  );

  // Same-opportunity state consistency: every row of opp-1 carries the same
  // myState, even though they are scattered non-adjacently in the timeline.
  assert.ok(
    rows.filter((row) => row.opportunityId === 'opp-1').every((row) => row.myState === 'planned'),
  );
  assert.ok(
    rows.filter((row) => row.opportunityId === 'opp-2').every((row) => row.myState === null),
  );
});

void test('buildTicketOpportunityTimelineRows marks exactly one first row per opportunity', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-open',
          opportunityId: 'opp-1',
          milestoneType: 'application_open',
          dateValue: '2026-09-01',
        }),
        milestone({
          id: 'ms-close',
          opportunityId: 'opp-1',
          milestoneType: 'application_close',
          dateValue: '2026-09-05',
        }),
      ],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const firstRows = rows.filter((row) => row.isFirstRowForOpportunity);
  assert.equal(firstRows.length, 1);
  assert.equal(firstRows[0]?.id, 'ms-open');
});

void test('buildTicketOpportunityTimelineRows resolves selected_occurrences targets and sorts them', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1', targetScope: 'selected_occurrences' }),
      targetOccurrenceIds: ['occ-later', 'occ-earlier', 'occ-missing'],
      milestones: [milestone({ id: 'ms-open', opportunityId: 'opp-1' })],
      myState: null,
    },
  ];

  const occurrencesById = new Map([
    ['occ-later', occurrence({ id: 'occ-later', startsAt: '2026-09-20T00:00:00.000Z' })],
    ['occ-earlier', occurrence({ id: 'occ-earlier', startsAt: '2026-09-10T00:00:00.000Z' })],
  ]);

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    occurrencesById,
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0]?.targetOccurrences.map((o) => o.id),
    ['occ-earlier', 'occ-later'],
    'unresolvable occurrence ids are dropped, resolved ones are sorted chronologically',
  );
});

void test('buildTicketOpportunityTimelineRows drops an Opportunity whose Event cannot be resolved', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1', eventId: 'missing-event' }),
      targetOccurrenceIds: [],
      milestones: [milestone({ id: 'ms-1', opportunityId: 'opp-1' })],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(details, new Map(), new Map());
  assert.deepEqual(rows, []);
});

void test('groupTicketOpportunityTimelineRowsByMonth groups contiguous same-month rows', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({ id: 'ms-sep-1', dateValue: '2026-09-01' }),
        milestone({ id: 'ms-sep-2', dateValue: '2026-09-15' }),
        milestone({ id: 'ms-oct-1', dateValue: '2026-10-01' }),
      ],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const groups = groupTicketOpportunityTimelineRowsByMonth(rows);

  assert.deepEqual(
    groups.map((g) => g.monthKey),
    ['2026-09', '2026-10'],
  );
  assert.deepEqual(
    groups[0]?.rows.map((r) => r.id),
    ['ms-sep-1', 'ms-sep-2'],
  );
  assert.deepEqual(
    groups[1]?.rows.map((r) => r.id),
    ['ms-oct-1'],
  );
});
