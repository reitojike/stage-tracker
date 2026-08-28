import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatTicketOpportunityMilestoneDisplay,
  isActionableTicketOpportunityDeadline,
  ticketOpportunityDeadlineRemainingDaysLabel,
  ticketOpportunityMilestoneTypeLabel,
  ticketOpportunityStateBadgeVariant,
  ticketOpportunityStateLabel,
  ticketOpportunityTargetScopeSummaryLabel,
  ticketOpportunityTimelineMonthHeadingLabel,
} from '../ticketOpportunityFormatting.ts';
import type { TicketOpportunityTimelineRow } from '../ticketOpportunityTimeline.ts';

function baseRow(
  overrides: Partial<TicketOpportunityTimelineRow> = {},
): TicketOpportunityTimelineRow {
  return {
    id: 'ms-1',
    opportunityId: 'opp-1',
    sortInstant: '2026-09-01T00:00:00.000Z',
    eventTitle: 'イベントA',
    eventVenue: '会場A',
    opportunityDisplayName: '第1抽選',
    sourceUrl: null,
    targetScope: 'event_wide',
    targetOccurrences: [],
    milestoneType: 'application_open',
    temporalPrecision: 'date',
    dateValue: '2026-09-01',
    at: null,
    startsAt: null,
    endsAt: null,
    myState: null,
    isFirstRowForOpportunity: false,
    ...overrides,
  };
}

void test('ticketOpportunityMilestoneTypeLabel maps every canonical type', () => {
  assert.equal(ticketOpportunityMilestoneTypeLabel('application_open'), '申込開始');
  assert.equal(ticketOpportunityMilestoneTypeLabel('application_close'), '申込締切');
  assert.equal(ticketOpportunityMilestoneTypeLabel('result_announcement'), '結果発表');
  assert.equal(ticketOpportunityMilestoneTypeLabel('sale_start'), '販売開始');
  assert.equal(ticketOpportunityMilestoneTypeLabel('payment_window'), '入金期間');
});

void test('ticketOpportunityStateLabel / ticketOpportunityStateBadgeVariant', () => {
  assert.equal(ticketOpportunityStateLabel('planned'), '申し込む予定');
  assert.equal(ticketOpportunityStateLabel('applied'), '申し込み済み');
  assert.equal(ticketOpportunityStateBadgeVariant('planned'), 'subtle');
  assert.equal(ticketOpportunityStateBadgeVariant('applied'), 'subtle');
});

void test('ticketOpportunityTimelineMonthHeadingLabel formats a "YYYY-MM" key', () => {
  assert.equal(ticketOpportunityTimelineMonthHeadingLabel('2026-09'), '2026年9月');
  assert.equal(ticketOpportunityTimelineMonthHeadingLabel('2026-12'), '2026年12月');
});

void test('formatTicketOpportunityMilestoneDisplay: date precision never fabricates a time', () => {
  const display = formatTicketOpportunityMilestoneDisplay(
    baseRow({ temporalPrecision: 'date', dateValue: '2026-09-10' }),
  );
  assert.equal(display.timeLabel, null);
  assert.match(display.dateLabel, /^9月10日\(.\)$/);
});

void test('formatTicketOpportunityMilestoneDisplay: datetime precision shows the exact time', () => {
  const display = formatTicketOpportunityMilestoneDisplay(
    baseRow({
      temporalPrecision: 'datetime',
      dateValue: null,
      at: '2026-09-05T08:00:00.000Z', // 17:00 JST
    }),
  );
  assert.equal(display.timeLabel, '17:00');
  assert.match(display.dateLabel, /^9月5日\(.\)$/);
});

void test('formatTicketOpportunityMilestoneDisplay: same-day window compacts the time range', () => {
  const display = formatTicketOpportunityMilestoneDisplay(
    baseRow({
      temporalPrecision: 'window',
      dateValue: null,
      startsAt: '2026-09-10T09:00:00.000Z', // 18:00 JST
      endsAt: '2026-09-10T14:59:00.000Z', // 23:59 JST
    }),
  );
  assert.equal(display.timeLabel, '18:00〜23:59');
  assert.match(display.dateLabel, /^9月10日\(.\)$/);
});

void test('formatTicketOpportunityMilestoneDisplay: multi-day window shows both dates', () => {
  const display = formatTicketOpportunityMilestoneDisplay(
    baseRow({
      temporalPrecision: 'window',
      dateValue: null,
      startsAt: '2026-09-10T09:00:00.000Z', // 9/10 18:00 JST
      endsAt: '2026-09-13T14:59:00.000Z', // 9/13 23:59 JST
    }),
  );
  assert.match(display.dateLabel, /9月10日\(.\) 〜 9月13日\(.\)/);
  assert.equal(display.timeLabel, '18:00 〜 23:59');
});

void test('formatTicketOpportunityMilestoneDisplay throws on a malformed row rather than guessing', () => {
  assert.throws(() =>
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'date', dateValue: null }),
    ),
  );
  assert.throws(() =>
    formatTicketOpportunityMilestoneDisplay(baseRow({ temporalPrecision: 'datetime', at: null })),
  );
  assert.throws(() =>
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'window', startsAt: null, endsAt: null }),
    ),
  );
});

void test('isActionableTicketOpportunityDeadline: only planned + application_close + not-past', () => {
  const today = '2026-09-05';

  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
      }),
      today,
    ),
    true,
  );

  // No personal state at all.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: null,
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
      }),
      today,
    ),
    false,
  );

  // applied (already submitted) is not "still to act on".
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'applied',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
      }),
      today,
    ),
    false,
  );

  // A window-precision application_close (nothing ties milestone_type to
  // temporal_precision in the schema) is judged by its *end*, not its
  // start - the window's start alone would make this look already past
  // days before it actually closes.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'window',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-08T00:00:00.000Z',
      }),
      today,
    ),
    true,
  );
  assert.equal(
    ticketOpportunityDeadlineRemainingDaysLabel(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'window',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-08T00:00:00.000Z',
      }),
      today,
    ),
    '残り3日',
  );

  // result_announcement/sale_start/payment_window never escalate to red.
  for (const milestoneType of ['result_announcement', 'sale_start', 'payment_window'] as const) {
    assert.equal(
      isActionableTicketOpportunityDeadline(
        baseRow({
          myState: 'planned',
          milestoneType,
          temporalPrecision: 'date',
          dateValue: '2026-09-08',
        }),
        today,
      ),
      false,
    );
  }

  // A past application_close is never actionable.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-01',
      }),
      today,
    ),
    false,
  );

  // Today itself still counts as actionable (not yet past).
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: today,
      }),
      today,
    ),
    true,
  );
});

void test('ticketOpportunityDeadlineRemainingDaysLabel: null unless actionable, else a day count', () => {
  const today = '2026-09-05';

  assert.equal(
    ticketOpportunityDeadlineRemainingDaysLabel(
      baseRow({ myState: null, milestoneType: 'application_close', dateValue: '2026-09-08' }),
      today,
    ),
    null,
  );

  assert.equal(
    ticketOpportunityDeadlineRemainingDaysLabel(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        dateValue: '2026-09-08',
      }),
      today,
    ),
    '残り3日',
  );

  assert.equal(
    ticketOpportunityDeadlineRemainingDaysLabel(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        dateValue: today,
      }),
      today,
    ),
    '本日締切',
  );
});

void test('ticketOpportunityTargetScopeSummaryLabel: event_wide vs selected_occurrences', () => {
  assert.equal(
    ticketOpportunityTargetScopeSummaryLabel(baseRow({ targetScope: 'event_wide' })),
    '公演全体',
  );

  const withOccurrence = ticketOpportunityTargetScopeSummaryLabel(
    baseRow({
      targetScope: 'selected_occurrences',
      targetOccurrences: [
        {
          id: 'occ-1',
          eventId: 'event-1',
          doorsAt: null,
          startsAt: '2026-09-10T02:00:00.000Z', // 11:00 JST
          endsAt: null,
          canceledAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
  );
  assert.match(withOccurrence, /対象公演回:/);
  assert.match(withOccurrence, /11:00/);

  assert.equal(
    ticketOpportunityTargetScopeSummaryLabel(
      baseRow({ targetScope: 'selected_occurrences', targetOccurrences: [] }),
    ),
    '対象の公演回情報がありません',
  );
});
