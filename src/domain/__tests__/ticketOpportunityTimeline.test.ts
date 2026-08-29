import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
  isTicketOpportunityTimelineRowPast,
  selectTicketOpportunityPrimaryRows,
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
  // Codex targeted-closure finding on PR #173: targetOccurrenceIdCount must
  // reflect the full *requested* count (3, including the unresolvable
  // occ-missing), not the resolved count (2) - this is what lets
  // isTicketOpportunityRowEffectivelyCanceled (ticketOpportunityFormatting.ts)
  // tell a partial resolution apart from a genuinely complete one.
  assert.equal(rows[0].targetOccurrenceIdCount, 3);
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

void test("buildTicketOpportunityTimelineRows carries the parent Event's effective cancellation onto every row (Issue #172 root cause B)", () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-active' }),
      targetOccurrenceIds: [],
      milestones: [milestone({ id: 'ms-active', opportunityId: 'opp-active' })],
      myState: null,
    },
    {
      opportunity: opportunity({ id: 'opp-canceled', eventId: 'event-canceled' }),
      targetOccurrenceIds: [],
      milestones: [milestone({ id: 'ms-canceled', opportunityId: 'opp-canceled' })],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([
      ['event-1', event({ id: 'event-1', canceledAt: null })],
      ['event-canceled', event({ id: 'event-canceled', canceledAt: '2026-08-01T00:00:00.000Z' })],
    ]),
    new Map(),
  );

  const activeRow = rows.find((row) => row.id === 'ms-active');
  const canceledRow = rows.find((row) => row.id === 'ms-canceled');
  assert.equal(activeRow?.eventCanceled, false);
  assert.equal(canceledRow?.eventCanceled, true);
});

void test("buildTicketOpportunityTimelineRows preserves each target Occurrence's own canceledAt (not collapsed)", () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1', targetScope: 'selected_occurrences' }),
      targetOccurrenceIds: ['occ-live', 'occ-canceled'],
      milestones: [milestone({ id: 'ms-1', opportunityId: 'opp-1' })],
      myState: null,
    },
  ];

  const occurrencesById = new Map([
    ['occ-live', occurrence({ id: 'occ-live', startsAt: '2026-09-10T00:00:00.000Z' })],
    [
      'occ-canceled',
      occurrence({
        id: 'occ-canceled',
        startsAt: '2026-09-11T00:00:00.000Z',
        canceledAt: '2026-08-01T00:00:00.000Z',
      }),
    ],
  ]);

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    occurrencesById,
  );

  assert.equal(rows.length, 1);
  const targets = rows[0]?.targetOccurrences ?? [];
  assert.equal(targets.find((o) => o.id === 'occ-live')?.canceledAt, null);
  assert.equal(
    targets.find((o) => o.id === 'occ-canceled')?.canceledAt,
    '2026-08-01T00:00:00.000Z',
  );
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

// --- isTicketOpportunityTimelineRowPast (Issue #175) ------------------------

void test('isTicketOpportunityTimelineRowPast: date precision is current through its own Asia/Tokyo day, past the day after', () => {
  const row = {
    temporalPrecision: 'date' as const,
    dateValue: '2026-09-01',
    at: null,
    endsAt: null,
  };
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-08-31T20:00:00.000Z', '2026-09-01'),
    false,
    'the milestone day itself is still current, not past',
  );
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-09-02T20:00:00.000Z', '2026-09-02'),
    true,
    'the day after is past',
  );
});

void test('isTicketOpportunityTimelineRowPast: datetime precision compares the exact instant', () => {
  const row = {
    temporalPrecision: 'datetime' as const,
    dateValue: null,
    at: '2026-09-01T08:00:00.000Z',
    endsAt: null,
  };
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-09-01T07:59:59.999Z', '2026-09-01'),
    false,
    'just before `at` is not yet past',
  );
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-09-01T08:00:00.001Z', '2026-09-01'),
    true,
    'just after `at` is past',
  );
});

void test('isTicketOpportunityTimelineRowPast: window precision is current for its whole span, past only after endsAt', () => {
  const row = {
    temporalPrecision: 'window' as const,
    dateValue: null,
    at: null,
    endsAt: '2026-09-04T14:00:00.000Z',
  };
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-09-04T13:59:59.999Z', '2026-09-04'),
    false,
    'still within the window (just before endsAt) is not past',
  );
  assert.equal(
    isTicketOpportunityTimelineRowPast(row, '2026-09-04T14:00:00.001Z', '2026-09-04'),
    true,
    'just after endsAt is past',
  );
});

// --- selectTicketOpportunityPrimaryRows (Issue #175) ------------------------

// The Issue #175 canonical worked example: one Opportunity with
// 9/1 application_open, 9/4 application_close, 9/8 result_announcement,
// checked at four fixed clock readings.
function issueExampleDetails(): TicketOpportunityWithDetails[] {
  return [
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
          dateValue: '2026-09-04',
        }),
        milestone({
          id: 'ms-result',
          opportunityId: 'opp-1',
          milestoneType: 'result_announcement',
          dateValue: '2026-09-08',
        }),
      ],
      myState: null,
    },
  ];
}

function primaryRowIdsAt(todayTokyoDate: string): string[] {
  const rows = buildTicketOpportunityTimelineRows(
    issueExampleDetails(),
    new Map([['event-1', event()]]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    `${todayTokyoDate}T03:00:00.000Z`,
    todayTokyoDate,
  );
  return primary.map((row) => row.id);
}

void test('selectTicketOpportunityPrimaryRows: Issue #175 worked example switches as the clock advances', () => {
  assert.deepEqual(primaryRowIdsAt('2026-08-30'), ['ms-open'], '8/30 -> 9/1だけ');
  assert.deepEqual(
    primaryRowIdsAt('2026-09-01'),
    ['ms-open'],
    'milestone day itself is still current',
  );
  assert.deepEqual(primaryRowIdsAt('2026-09-03'), ['ms-close'], '9/3 -> 9/4だけ');
  assert.deepEqual(primaryRowIdsAt('2026-09-07'), ['ms-result'], '9/7 -> 9/8だけ');
  // Issue #192 bounded post-final retention supersedes #175's original
  // immediate-disappearance rule: the final milestone (9/8) going past no
  // longer drops the Opportunity outright - it stays as terminal history
  // through TICKET_POST_FINAL_RETENTION_DAYS (7 days: 9/9..9/15), and only
  // disappears from 9/16 onward. See the dedicated retention boundary tests
  // below for the exact day 7/8 cutoff.
  assert.deepEqual(
    primaryRowIdsAt('2026-09-10'),
    ['ms-result'],
    '9/10 -> 9/8終了から2日後、bounded post-final terminal historyとして残る',
  );
  assert.deepEqual(
    primaryRowIdsAt('2026-09-15'),
    ['ms-result'],
    '9/15 -> 9/8終了から7日後、まだ残る（retention最終日）',
  );
  assert.deepEqual(
    primaryRowIdsAt('2026-09-16'),
    [],
    '9/16 -> 9/8終了から8日後、retentionを過ぎてOpportunity自体がprimary viewから消える',
  );
});

void test('selectTicketOpportunityPrimaryRows: an active window is not fast-forwarded to the next milestone', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-window',
          opportunityId: 'opp-1',
          milestoneType: 'payment_window',
          temporalPrecision: 'window',
          dateValue: null,
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-09-05T00:00:00.000Z',
        }),
        milestone({
          id: 'ms-after',
          opportunityId: 'opp-1',
          milestoneType: 'result_announcement',
          dateValue: '2026-09-10',
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

  const beforeWindow = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-08-31T23:00:00.000Z',
    '2026-09-01',
  );
  assert.deepEqual(
    beforeWindow.map((r) => r.id),
    ['ms-window'],
    'upcoming: window not yet started',
  );

  const duringWindow = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-03T12:00:00.000Z',
    '2026-09-03',
  );
  assert.deepEqual(
    duringWindow.map((r) => r.id),
    ['ms-window'],
    'current: still the window, not fast-forwarded to the later milestone',
  );

  const afterWindow = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-06T00:00:00.000Z',
    '2026-09-06',
  );
  assert.deepEqual(
    afterWindow.map((r) => r.id),
    ['ms-after'],
    'past: window ended, advances to the next milestone',
  );
});

void test('selectTicketOpportunityPrimaryRows: selects at most one row per Opportunity, chronologically interleaved across Opportunities', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-a', displayName: 'A' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({ id: 'a-past', opportunityId: 'opp-a', dateValue: '2026-08-01' }),
        milestone({
          id: 'a-next',
          opportunityId: 'opp-a',
          milestoneType: 'application_close',
          dateValue: '2026-09-05',
        }),
        milestone({
          id: 'a-future',
          opportunityId: 'opp-a',
          milestoneType: 'result_announcement',
          dateValue: '2026-09-20',
        }),
      ],
      myState: myState({ opportunityId: 'opp-a', status: 'applied' }),
    },
    {
      opportunity: opportunity({ id: 'opp-b', displayName: 'B' }),
      targetOccurrenceIds: [],
      milestones: [milestone({ id: 'b-next', opportunityId: 'opp-b', dateValue: '2026-09-02' })],
      myState: null,
    },
  ];

  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-01T03:00:00.000Z',
    '2026-09-01',
  );

  assert.deepEqual(
    primary.map((r) => r.id),
    ['b-next', 'a-next'],
    "one row per Opportunity, chronologically ordered - opp-a's past row and second future row are dropped",
  );
  assert.ok(
    primary.every((row) => row.isFirstRowForOpportunity),
    'every selected row is forced isFirstRowForOpportunity (personal-state control anchor)',
  );
  const aRow = primary.find((r) => r.opportunityId === 'opp-a');
  assert.equal(
    aRow?.myState,
    'applied',
    'personal planning state is preserved on the selected row',
  );
});

void test('selectTicketOpportunityPrimaryRows: an Opportunity with no non-past milestones disappears entirely', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1' }),
      targetOccurrenceIds: [],
      milestones: [milestone({ id: 'ms-past', opportunityId: 'opp-1', dateValue: '2026-01-01' })],
      myState: myState({ opportunityId: 'opp-1', status: 'planned' }),
    },
  ];
  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-01T03:00:00.000Z',
    '2026-09-01',
  );
  assert.deepEqual(
    primary,
    [],
    'no future/current milestone remains, so the Opportunity is dropped',
  );
});

void test('selectTicketOpportunityPrimaryRows: cancellation is preserved on the selected row (Issue #172)', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-canceled', eventId: 'event-canceled' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-canceled-next',
          opportunityId: 'opp-canceled',
          dateValue: '2026-09-05',
        }),
      ],
      myState: myState({ opportunityId: 'opp-canceled', status: 'planned' }),
    },
  ];
  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([
      ['event-canceled', event({ id: 'event-canceled', canceledAt: '2026-08-01T00:00:00.000Z' })],
    ]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-01T03:00:00.000Z',
    '2026-09-01',
  );

  assert.equal(primary.length, 1);
  const row = primary[0];
  assert.ok(row);
  assert.equal(
    row.eventCanceled,
    true,
    'a canceled Opportunity with a future milestone still surfaces',
  );
  assert.equal(row.myState, 'planned', 'canceling does not delete personal state');
});

// --- Issue #192: bounded post-final retention ------------------------------

function singleMilestoneOpportunityRows(
  finalMilestoneOverrides: Partial<TicketOpportunityMilestone>,
  detailOverrides: Partial<TicketOpportunityWithDetails> = {},
) {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-1' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-final',
          opportunityId: 'opp-1',
          milestoneType: 'application_close',
          ...finalMilestoneOverrides,
        }),
      ],
      myState: myState({ opportunityId: 'opp-1', status: 'planned' }),
      ...detailOverrides,
    },
  ];
  return buildTicketOpportunityTimelineRows(details, new Map([['event-1', event()]]), new Map());
}

void test('selectTicketOpportunityPrimaryRows: a date-precision final milestone is retained through day 7 and dropped on day 8', () => {
  const rows = singleMilestoneOpportunityRows({
    temporalPrecision: 'date',
    dateValue: '2026-09-01',
  });

  const day7 = selectTicketOpportunityPrimaryRows(rows, '2026-09-08T03:00:00.000Z', '2026-09-08');
  assert.deepEqual(
    day7.map((r) => r.id),
    ['ms-final'],
    'day 7 after the final day: still retained',
  );
  assert.equal(day7[0]?.isPostFinalRetainedHistory, true);

  const day8 = selectTicketOpportunityPrimaryRows(rows, '2026-09-09T03:00:00.000Z', '2026-09-09');
  assert.deepEqual(day8, [], 'day 8 after the final day: dropped entirely');
});

void test('selectTicketOpportunityPrimaryRows: a datetime-precision final milestone retains using the Tokyo calendar date of `at`', () => {
  // `at` is 2026-09-01T20:00:00Z, which is 2026-09-02 05:00 Asia/Tokyo - the
  // retention window must anchor on that Tokyo calendar day (9/2), not the
  // raw UTC date (9/1).
  const rows = singleMilestoneOpportunityRows({
    temporalPrecision: 'datetime',
    dateValue: null,
    at: '2026-09-01T20:00:00.000Z',
  });

  const day7 = selectTicketOpportunityPrimaryRows(rows, '2026-09-09T03:00:00.000Z', '2026-09-09');
  assert.deepEqual(
    day7.map((r) => r.id),
    ['ms-final'],
    'day 7 after the Tokyo final day (9/2): retained',
  );

  const day8 = selectTicketOpportunityPrimaryRows(rows, '2026-09-10T03:00:00.000Z', '2026-09-10');
  assert.deepEqual(day8, [], 'day 8 after the Tokyo final day (9/2): dropped');
});

void test('selectTicketOpportunityPrimaryRows: a window-precision final milestone retains using the Tokyo calendar date of endsAt', () => {
  const rows = singleMilestoneOpportunityRows({
    temporalPrecision: 'window',
    dateValue: null,
    startsAt: '2026-08-28T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
  });

  const day7 = selectTicketOpportunityPrimaryRows(rows, '2026-09-08T03:00:00.000Z', '2026-09-08');
  assert.deepEqual(
    day7.map((r) => r.id),
    ['ms-final'],
    'day 7 after endsAt (9/1): retained',
  );

  const day8 = selectTicketOpportunityPrimaryRows(rows, '2026-09-09T03:00:00.000Z', '2026-09-09');
  assert.deepEqual(day8, [], 'day 8 after endsAt (9/1): dropped');
});

void test('selectTicketOpportunityPrimaryRows: a retained row never coexists with a current/next row for the same Opportunity (max 1 invariant)', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-retained' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-retained-final',
          opportunityId: 'opp-retained',
          dateValue: '2026-09-01',
        }),
      ],
      myState: null,
    },
    {
      opportunity: opportunity({ id: 'opp-current' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({ id: 'ms-current-next', opportunityId: 'opp-current', dateValue: '2026-09-10' }),
      ],
      myState: null,
    },
  ];
  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-05T03:00:00.000Z',
    '2026-09-05',
  );

  assert.equal(primary.length, 2, 'exactly one row per Opportunity, whichever kind');
  const retained = primary.find((r) => r.opportunityId === 'opp-retained');
  const current = primary.find((r) => r.opportunityId === 'opp-current');
  assert.equal(retained?.isPostFinalRetainedHistory, true);
  assert.equal(current?.isPostFinalRetainedHistory, false);
  assert.ok(
    primary.every((r) => r.isFirstRowForOpportunity),
    'both remain the personal-state control anchor for their own Opportunity',
  );
});

void test('selectTicketOpportunityPrimaryRows: retained rows sort chronologically alongside current/next rows, ready for month grouping', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-current', displayName: 'current' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({ id: 'ms-current', opportunityId: 'opp-current', dateValue: '2026-09-10' }),
      ],
      myState: null,
    },
    {
      opportunity: opportunity({ id: 'opp-retained', displayName: 'retained' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({ id: 'ms-retained', opportunityId: 'opp-retained', dateValue: '2026-09-01' }),
      ],
      myState: null,
    },
  ];
  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([['event-1', event()]]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-05T03:00:00.000Z',
    '2026-09-05',
  );

  assert.deepEqual(
    primary.map((r) => r.id),
    ['ms-retained', 'ms-current'],
    'the past retained row sorts ahead of the future current/next row',
  );
});

void test('selectTicketOpportunityPrimaryRows: personal planned/applied state is preserved on a retained row, never mutated', () => {
  const rows = singleMilestoneOpportunityRows(
    { dateValue: '2026-09-01' },
    { myState: myState({ opportunityId: 'opp-1', status: 'applied' }) },
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-05T03:00:00.000Z',
    '2026-09-05',
  );
  assert.equal(primary[0]?.myState, 'applied');
});

void test('selectTicketOpportunityPrimaryRows: a canceled Opportunity retains eventCanceled alongside isPostFinalRetainedHistory - presentation, not domain, decides which terminal badge wins', () => {
  const details: TicketOpportunityWithDetails[] = [
    {
      opportunity: opportunity({ id: 'opp-canceled', eventId: 'event-canceled' }),
      targetOccurrenceIds: [],
      milestones: [
        milestone({
          id: 'ms-canceled-final',
          opportunityId: 'opp-canceled',
          dateValue: '2026-09-01',
        }),
      ],
      myState: myState({ opportunityId: 'opp-canceled', status: 'planned' }),
    },
  ];
  const rows = buildTicketOpportunityTimelineRows(
    details,
    new Map([
      ['event-canceled', event({ id: 'event-canceled', canceledAt: '2026-08-01T00:00:00.000Z' })],
    ]),
    new Map(),
  );
  const primary = selectTicketOpportunityPrimaryRows(
    rows,
    '2026-09-05T03:00:00.000Z',
    '2026-09-05',
  );

  assert.equal(primary.length, 1);
  const row = primary[0];
  assert.ok(row);
  assert.equal(row.eventCanceled, true);
  assert.equal(row.isPostFinalRetainedHistory, true);
});
