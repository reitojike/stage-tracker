import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatTicketOpportunityMilestoneDisplay,
  isActionableTicketOpportunityDeadline,
  isTicketOpportunityRowEffectivelyCanceled,
  ticketOpportunityDeadlineBadge,
  ticketOpportunityMilestoneTypeLabel,
  ticketOpportunityStateBadgeVariant,
  ticketOpportunityStateLabel,
  ticketOpportunityTargetScopeSummaryLabel,
  ticketOpportunityTimelineMonthHeadingLabel,
} from '../ticketOpportunityFormatting.ts';
import type { EventOccurrence } from '../eventCatalog.ts';
import type { TicketOpportunityTimelineRow } from '../ticketOpportunityTimeline.ts';

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

function baseRow(
  overrides: Partial<TicketOpportunityTimelineRow> = {},
): TicketOpportunityTimelineRow {
  return {
    id: 'ms-1',
    opportunityId: 'opp-1',
    sortInstant: '2026-09-01T00:00:00.000Z',
    eventTitle: 'イベントA',
    eventVenue: '会場A',
    eventCanceled: false,
    opportunityDisplayName: '第1抽選',
    sourceUrl: null,
    targetScope: 'event_wide',
    targetOccurrences: [],
    targetOccurrenceIdCount: 0,
    milestoneType: 'application_open',
    temporalPrecision: 'date',
    dateValue: '2026-09-01',
    at: null,
    startsAt: null,
    endsAt: null,
    myState: null,
    isFirstRowForOpportunity: false,
    isPostFinalRetainedHistory: false,
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
  assert.match(display.dateLabel, /^9月10日（.）$/);
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
  assert.match(display.dateLabel, /^9月5日（.）$/);
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
  assert.match(display.dateLabel, /^9月10日（.）$/);
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
  assert.match(display.dateLabel, /9月10日（.） 〜 9月13日（.）/);
  assert.equal(display.timeLabel, '18:00 〜 23:59');
});

// --- Issue #189: shared day-role/color authority reused for the date column ---

void test('formatTicketOpportunityMilestoneDisplay: role reflects the shared calendarDayRole authority, not a re-derived judgment', () => {
  // 2026-09-05 is a Saturday, 2026-09-06 is a Sunday (both plain, not
  // holidays).
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'date', dateValue: '2026-09-05' }),
    ).role,
    'saturday',
  );
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'date', dateValue: '2026-09-06' }),
    ).role,
    'sunday',
  );
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'date', dateValue: '2026-09-10' }),
    ).role,
    'weekday',
  );
  // 2026-01-01 (元日) is a confirmed holiday.
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({ temporalPrecision: 'date', dateValue: '2026-01-01' }),
    ).role,
    'holiday',
  );
});

void test('formatTicketOpportunityMilestoneDisplay: accessibleDateLabel carries the holiday name only for the holiday role, and the visible dateLabel never substitutes it for the weekday glyph', () => {
  const holidayDisplay = formatTicketOpportunityMilestoneDisplay(
    baseRow({ temporalPrecision: 'date', dateValue: '2026-01-01' }),
  );
  assert.equal(holidayDisplay.dateLabel, '1月1日（木）');
  assert.equal(holidayDisplay.accessibleDateLabel, '1月1日（木）（元日）');

  const ordinaryDisplay = formatTicketOpportunityMilestoneDisplay(
    baseRow({ temporalPrecision: 'date', dateValue: '2026-09-10' }),
  );
  assert.equal(ordinaryDisplay.accessibleDateLabel, ordinaryDisplay.dateLabel);
});

void test('formatTicketOpportunityMilestoneDisplay: holiday role and accessibleDateLabel also resolve correctly for datetime and window precision, not just date precision', () => {
  // 2025-12-31T15:00:00Z = 2026-01-01 00:00 JST (元日, a confirmed holiday).
  const datetimeDisplay = formatTicketOpportunityMilestoneDisplay(
    baseRow({ temporalPrecision: 'datetime', dateValue: null, at: '2025-12-31T15:00:00.000Z' }),
  );
  assert.equal(datetimeDisplay.role, 'holiday');
  assert.equal(datetimeDisplay.dateLabel, '1月1日（木）');
  assert.equal(datetimeDisplay.accessibleDateLabel, '1月1日（木）（元日）');

  // Window starting 2026-01-01 (元日) through 2026-01-03 - role/accessible
  // label derive from the *start* date per this module's own documented
  // convention, even though the visible dateLabel shows both ends.
  const windowDisplay = formatTicketOpportunityMilestoneDisplay(
    baseRow({
      temporalPrecision: 'window',
      dateValue: null,
      startsAt: '2025-12-31T20:00:00.000Z', // 2026-01-01 05:00 JST
      endsAt: '2026-01-03T10:00:00.000Z', // 2026-01-03 19:00 JST
    }),
  );
  assert.equal(windowDisplay.role, 'holiday');
  assert.match(windowDisplay.dateLabel, /^1月1日（木） 〜 1月3日（.）$/);
  assert.equal(windowDisplay.accessibleDateLabel, '1月1日（木）（元日）');
});

void test('formatTicketOpportunityMilestoneDisplay: datetime/window precision derive role from the same shared authority', () => {
  // 2026-09-05T08:00:00Z = 2026-09-05 17:00 JST, a Saturday.
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({
        temporalPrecision: 'datetime',
        dateValue: null,
        at: '2026-09-05T08:00:00.000Z',
      }),
    ).role,
    'saturday',
  );
  // Window role is derived from the *start* date (2026-09-10, a Thursday).
  assert.equal(
    formatTicketOpportunityMilestoneDisplay(
      baseRow({
        temporalPrecision: 'window',
        dateValue: null,
        startsAt: '2026-09-10T09:00:00.000Z',
        endsAt: '2026-09-13T14:59:00.000Z',
      }),
    ).role,
    'weekday',
  );
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
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'window',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-08T00:00:00.000Z',
      }),
      today,
    ),
    { variant: 'deadline', label: '残り3日' },
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

// --- Issue #191: ticketOpportunityDeadlineBadge canonical threshold ---
//
// | day difference | variant  | label                        |
// | 0 (today)       | deadline | 本日 HH:MMまで / 本日締切     |
// | 1-3             | deadline | 残りN日                      |
// | 4-13            | outline  | 残りN日                      |
// | 14+             | (none)   | null                         |
// | already past    | terminal | 受付終了                     |

void test('ticketOpportunityDeadlineBadge: today with an exact source datetime shows "本日 HH:MMまで", never "残り0日"', () => {
  const today = '2026-09-05';
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'datetime',
        dateValue: null,
        at: '2026-09-05T14:59:00.000Z', // 23:59 JST
      }),
      today,
    ),
    { variant: 'deadline', label: '本日 23:59まで' },
  );
});

void test('ticketOpportunityDeadlineBadge: today with only a date-only source never fabricates a time', () => {
  const today = '2026-09-05';
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: today,
      }),
      today,
    ),
    { variant: 'deadline', label: '本日締切' },
  );
});

void test('ticketOpportunityDeadlineBadge: day 1 and day 3 are both red (deadline)', () => {
  const today = '2026-09-05';
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-06' }),
      today,
    ),
    { variant: 'deadline', label: '残り1日' },
  );
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-08' }),
      today,
    ),
    { variant: 'deadline', label: '残り3日' },
  );
});

void test('ticketOpportunityDeadlineBadge: day 4 and day 13 are both outline, not red - the 9-day-early-red regression this Task fixes', () => {
  const today = '2026-09-05';
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-09' }),
      today,
    ),
    { variant: 'outline', label: '残り4日' },
  );
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-18' }),
      today,
    ),
    { variant: 'outline', label: '残り13日' },
  );
});

void test('ticketOpportunityDeadlineBadge: day 14 shows no badge at all', () => {
  const today = '2026-09-05';
  assert.equal(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-19' }),
      today,
    ),
    null,
  );
});

void test('ticketOpportunityDeadlineBadge: Tokyo midnight boundary - 23:59 JST today is still today, 00:00 JST tomorrow already rolled to day 1', () => {
  const today = '2026-09-05';
  // 2026-09-05T14:59:00Z = 2026-09-05 23:59 JST - the last instant of "today".
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'datetime',
        dateValue: null,
        at: '2026-09-05T14:59:00.000Z',
      }),
      today,
    ),
    { variant: 'deadline', label: '本日 23:59まで' },
  );
  // 2026-09-05T15:00:00Z = 2026-09-06 00:00 JST - already the next Tokyo
  // calendar day, so this is day 1, not day 0.
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'datetime',
        dateValue: null,
        at: '2026-09-05T15:00:00.000Z',
      }),
      today,
    ),
    { variant: 'deadline', label: '残り1日' },
  );
});

void test('ticketOpportunityDeadlineBadge: an already-past deadline classifies as terminal 受付終了, for a caller that intentionally retains the row', () => {
  const today = '2026-09-05';
  assert.deepEqual(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'planned', milestoneType: 'application_close', dateValue: '2026-09-04' }),
      today,
    ),
    { variant: 'terminal', label: '受付終了' },
  );
});

void test('ticketOpportunityDeadlineBadge: never broadens which milestones get urgency treatment - no-state, applied, and non-application milestones all return null', () => {
  const today = '2026-09-05';

  // No personal state at all.
  assert.equal(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: null, milestoneType: 'application_close', dateValue: '2026-09-06' }),
      today,
    ),
    null,
  );

  // Already applied - not "still to act on", even 1 day out.
  assert.equal(
    ticketOpportunityDeadlineBadge(
      baseRow({ myState: 'applied', milestoneType: 'application_close', dateValue: '2026-09-06' }),
      today,
    ),
    null,
  );

  // result_announcement/sale_start/payment_window never escalate to red or
  // any other urgency variant, even with a `planned` personal state.
  for (const milestoneType of ['result_announcement', 'sale_start', 'payment_window'] as const) {
    assert.equal(
      ticketOpportunityDeadlineBadge(
        baseRow({ myState: 'planned', milestoneType, dateValue: '2026-09-06' }),
        today,
      ),
      null,
    );
  }
});

void test('ticketOpportunityDeadlineBadge: an effectively canceled Opportunity never shows deadline urgency, past or future (Issue #172 root cause B)', () => {
  const today = '2026-09-05';

  assert.equal(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        dateValue: '2026-09-06',
        eventCanceled: true,
      }),
      today,
    ),
    null,
  );

  // Even an already-past deadline of a canceled Opportunity must not show
  // 受付終了 - the existing 中止 terminal authority owns that row instead.
  assert.equal(
    ticketOpportunityDeadlineBadge(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        dateValue: '2026-09-01',
        eventCanceled: true,
      }),
      today,
    ),
    null,
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

// --- Issue #172 root cause B: Opportunity-scope cancellation aggregation
// (Claude C1 + Codex X2 - one root cause, not "any one target canceled") ---

void test('isTicketOpportunityRowEffectivelyCanceled: Event canceled is terminal regardless of scope', () => {
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({ targetScope: 'event_wide', eventCanceled: true, targetOccurrences: [] }),
    ),
    true,
  );
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: true,
        targetOccurrences: [occurrence({ canceledAt: null })],
        targetOccurrenceIdCount: 1,
      }),
    ),
    true,
    'Event cancellation is terminal even when the selected target itself is still active',
  );
});

void test('isTicketOpportunityRowEffectivelyCanceled: event_wide is never canceled by one current Occurrence alone', () => {
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'event_wide',
        eventCanceled: false,
        // event_wide never carries targetOccurrences by construction, but
        // even if some were present, event_wide must ignore them entirely -
        // it is a semantic fact about the whole Event, never a snapshot of
        // current Occurrences.
        targetOccurrences: [occurrence({ canceledAt: '2026-08-01T00:00:00.000Z' })],
        targetOccurrenceIdCount: 1,
      }),
    ),
    false,
  );
});

void test('isTicketOpportunityRowEffectivelyCanceled: selected_occurrences is terminal only when the complete non-empty target set is all canceled', () => {
  // All targets canceled -> terminal.
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: false,
        targetOccurrences: [
          occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' }),
          occurrence({ id: 'occ-2', canceledAt: '2026-08-02T00:00:00.000Z' }),
        ],
        targetOccurrenceIdCount: 2,
      }),
    ),
    true,
  );

  // Only some targets canceled -> NOT terminal (remains actionable for the
  // live target).
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: false,
        targetOccurrences: [
          occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' }),
          occurrence({ id: 'occ-2', canceledAt: null }),
        ],
        targetOccurrenceIdCount: 2,
      }),
    ),
    false,
  );

  // No target canceled -> not terminal.
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: false,
        targetOccurrences: [occurrence({ id: 'occ-1', canceledAt: null })],
        targetOccurrenceIdCount: 1,
      }),
    ),
    false,
  );

  // An empty resolved target set (e.g. a defensive missing-read drop) must
  // never read as "all canceled" - that would infer global cancellation
  // from an incomplete/unresolved target set.
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: false,
        targetOccurrences: [],
        targetOccurrenceIdCount: 0,
      }),
    ),
    false,
  );

  // A *partially* resolved target set (Codex targeted-closure finding on
  // PR #173: buildTicketOpportunityTimelineRows drops unresolved target
  // ids rather than fabricating them, so a request for 3 targets can
  // resolve only 1) must NOT read the resolved subset's ".every(canceled)"
  // as "all targets canceled" - that is exactly the same
  // incomplete/unresolved-target-set inference the empty-set case above
  // already guards against, just with a non-empty but incomplete
  // resolved list.
  assert.equal(
    isTicketOpportunityRowEffectivelyCanceled(
      baseRow({
        targetScope: 'selected_occurrences',
        eventCanceled: false,
        // Only 1 of the originally-requested 3 targets resolved, and that
        // one happens to be canceled - the other 2 are unknown, not live.
        targetOccurrences: [occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' })],
        targetOccurrenceIdCount: 3,
      }),
    ),
    false,
    'a partially-resolved target set must not be read as "all canceled" merely because the resolved subset happens to be',
  );
});

void test('isActionableTicketOpportunityDeadline: never true once the whole Opportunity is effectively canceled', () => {
  const today = '2026-09-05';

  // Event canceled - would otherwise be actionable (planned +
  // application_close + not yet past).
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
        eventCanceled: true,
      }),
      today,
    ),
    false,
  );

  // All selected targets canceled.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
        targetScope: 'selected_occurrences',
        targetOccurrences: [occurrence({ canceledAt: '2026-08-01T00:00:00.000Z' })],
        targetOccurrenceIdCount: 1,
      }),
      today,
    ),
    false,
  );

  // Partial cancellation (one of several targets) must NOT suppress
  // actionability - a live target remains.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
        targetScope: 'selected_occurrences',
        targetOccurrences: [
          occurrence({ id: 'occ-1', canceledAt: '2026-08-01T00:00:00.000Z' }),
          occurrence({ id: 'occ-2', canceledAt: null }),
        ],
        targetOccurrenceIdCount: 2,
      }),
      today,
    ),
    true,
  );

  // event_wide is never canceled merely because one current Occurrence
  // (present here only to prove it is ignored for event_wide) is
  // canceled.
  assert.equal(
    isActionableTicketOpportunityDeadline(
      baseRow({
        myState: 'planned',
        milestoneType: 'application_close',
        temporalPrecision: 'date',
        dateValue: '2026-09-08',
        targetScope: 'event_wide',
        eventCanceled: false,
      }),
      today,
    ),
    true,
  );
});

void test('ticketOpportunityTargetScopeSummaryLabel: a partially canceled selected_occurrences target stays distinguishable without a whole-Opportunity 中止', () => {
  const label = ticketOpportunityTargetScopeSummaryLabel(
    baseRow({
      targetScope: 'selected_occurrences',
      targetOccurrences: [
        occurrence({
          id: 'occ-live',
          startsAt: '2026-09-10T02:00:00.000Z', // 11:00 JST
          canceledAt: null,
        }),
        occurrence({
          id: 'occ-canceled',
          startsAt: '2026-09-11T02:00:00.000Z', // 11:00 JST
          canceledAt: '2026-08-01T00:00:00.000Z',
        }),
      ],
    }),
  );
  assert.match(label, /対象公演回:/);
  // Both occurrences are still listed (partial cancellation never drops or
  // hides the live target)...
  assert.match(label, /9月10日/);
  assert.match(label, /9月11日/);
  // ...but only the canceled one carries the 中止 marker.
  const segments = label.split('、');
  const liveSegment = segments.find((segment) => segment.includes('9月10日'));
  const canceledSegment = segments.find((segment) => segment.includes('9月11日'));
  assert.ok(liveSegment !== undefined && !liveSegment.includes('中止'));
  assert.ok(canceledSegment !== undefined && canceledSegment.includes('中止'));
});
