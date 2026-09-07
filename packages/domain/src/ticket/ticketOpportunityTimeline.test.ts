import { describe, expect, it } from 'vitest';
import { eventIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';
import { ticketOpportunityIdSchema, ticketOpportunityMilestoneIdSchema } from './ids';
import type { TicketOpportunityMilestone } from './ticketOpportunityMilestone';
import {
  buildTicketOpportunityTimelineRows,
  groupTicketOpportunityTimelineRowsByMonth,
  isTicketOpportunityMilestonePast,
  isTicketOpportunityPostFinalRetained,
  selectTicketOpportunityPrimaryRows,
  ticketOpportunityMilestoneSortInstant,
  ticketOpportunityMilestoneTokyoCalendarDate,
  TICKET_POST_FINAL_RETENTION_DAYS,
  type TicketOpportunityAggregate,
} from './ticketOpportunityTimeline';

const eventId = eventIdSchema.parse('99999999-9999-4999-8999-999999999999');
const now = instantSchema.parse('2026-01-01T00:00:00Z');

function oppId(n: number) {
  return ticketOpportunityIdSchema.parse(`10000000-0000-4000-8000-00000000000${String(n)}`);
}

function milestoneId(n: number) {
  return ticketOpportunityMilestoneIdSchema.parse(
    `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  );
}

function dateMilestone(
  n: number,
  milestoneType: TicketOpportunityMilestone['milestoneType'],
  dateValue: string,
): TicketOpportunityMilestone {
  return {
    id: milestoneId(n),
    opportunityId: oppId(1),
    milestoneType,
    temporalPrecision: 'date',
    dateValue: tokyoCalendarDateSchema.parse(dateValue),
    createdAt: now,
    updatedAt: now,
  };
}

function datetimeMilestone(
  n: number,
  milestoneType: TicketOpportunityMilestone['milestoneType'],
  at: string,
): TicketOpportunityMilestone {
  return {
    id: milestoneId(n),
    opportunityId: oppId(1),
    milestoneType,
    temporalPrecision: 'datetime',
    at: instantSchema.parse(at),
    createdAt: now,
    updatedAt: now,
  };
}

function windowMilestone(
  n: number,
  milestoneType: TicketOpportunityMilestone['milestoneType'],
  startsAt: string,
  endsAt: string,
): TicketOpportunityMilestone {
  return {
    id: milestoneId(n),
    opportunityId: oppId(1),
    milestoneType,
    temporalPrecision: 'window',
    startsAt: instantSchema.parse(startsAt),
    endsAt: instantSchema.parse(endsAt),
    createdAt: now,
    updatedAt: now,
  };
}

describe('ticketOpportunityMilestoneSortInstant', () => {
  it('sorts a datetime milestone by its own at', () => {
    const milestone = datetimeMilestone(1, 'sale_start', '2026-03-10T10:00:00Z');
    expect(ticketOpportunityMilestoneSortInstant(milestone)).toBe('2026-03-10T10:00:00.000Z');
  });

  it('sorts a window milestone by its own startsAt (never endsAt)', () => {
    const milestone = windowMilestone(
      1,
      'payment_window',
      '2026-03-10T00:00:00Z',
      '2026-03-15T00:00:00Z',
    );
    expect(ticketOpportunityMilestoneSortInstant(milestone)).toBe('2026-03-10T00:00:00.000Z');
  });

  it('sorts a date milestone at the start of its own Tokyo calendar day, not raw UTC midnight', () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-10');
    // 2026-03-10T00:00:00+09:00 == 2026-03-09T15:00:00Z
    expect(ticketOpportunityMilestoneSortInstant(milestone)).toBe('2026-03-09T15:00:00.000Z');
  });
});

describe('ticketOpportunityMilestoneTokyoCalendarDate', () => {
  it('reads the dateValue directly for a date-precision milestone', () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-10');
    expect(ticketOpportunityMilestoneTokyoCalendarDate(milestone)).toBe('2026-03-10');
  });

  it('reads the Tokyo calendar date of `at` for a datetime-precision milestone', () => {
    // 2026-03-10T20:00:00Z == 2026-03-11T05:00:00+09:00
    const milestone = datetimeMilestone(1, 'sale_start', '2026-03-10T20:00:00Z');
    expect(ticketOpportunityMilestoneTokyoCalendarDate(milestone)).toBe('2026-03-11');
  });

  it('reads the Tokyo calendar date of endsAt (never startsAt) for a window-precision milestone', () => {
    const milestone = windowMilestone(
      1,
      'payment_window',
      '2026-03-01T00:00:00Z',
      '2026-03-15T00:00:00Z',
    );
    expect(ticketOpportunityMilestoneTokyoCalendarDate(milestone)).toBe('2026-03-15');
  });
});

describe('isTicketOpportunityMilestonePast - date precision', () => {
  const today = tokyoCalendarDateSchema.parse('2026-03-10');

  it('is non-past on its own day (boundary)', () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-10');
    expect(isTicketOpportunityMilestonePast(milestone, now, today)).toBe(false);
  });

  it('is past the day after', () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-09');
    expect(isTicketOpportunityMilestonePast(milestone, now, today)).toBe(true);
  });
});

describe('isTicketOpportunityMilestonePast - datetime precision', () => {
  const nowInstant = instantSchema.parse('2026-03-10T12:00:00Z');
  const today = tokyoCalendarDateSchema.parse('2026-03-10');

  it('is non-past one second before the instant', () => {
    const milestone = datetimeMilestone(1, 'sale_start', '2026-03-10T12:00:01Z');
    expect(isTicketOpportunityMilestonePast(milestone, nowInstant, today)).toBe(false);
  });

  it('is past one second after the instant', () => {
    const milestone = datetimeMilestone(1, 'sale_start', '2026-03-10T11:59:59Z');
    expect(isTicketOpportunityMilestonePast(milestone, nowInstant, today)).toBe(true);
  });
});

describe('isTicketOpportunityMilestonePast - window precision', () => {
  const nowInstant = instantSchema.parse('2026-03-10T12:00:00Z');
  const today = tokyoCalendarDateSchema.parse('2026-03-10');

  it('is non-past while inside the window, even after startsAt has elapsed', () => {
    const milestone = windowMilestone(
      1,
      'payment_window',
      '2026-03-01T00:00:00Z',
      '2026-03-20T00:00:00Z',
    );
    expect(isTicketOpportunityMilestonePast(milestone, nowInstant, today)).toBe(false);
  });

  it('is past once endsAt has elapsed', () => {
    const milestone = windowMilestone(
      1,
      'payment_window',
      '2026-03-01T00:00:00Z',
      '2026-03-05T00:00:00Z',
    );
    expect(isTicketOpportunityMilestonePast(milestone, nowInstant, today)).toBe(true);
  });
});

describe('isTicketOpportunityPostFinalRetained', () => {
  it(`retains a milestone exactly ${String(TICKET_POST_FINAL_RETENTION_DAYS)} days after its final day (boundary)`, () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-01');
    const today = tokyoCalendarDateSchema.parse('2026-03-08'); // 7 days after 2026-03-01
    expect(isTicketOpportunityPostFinalRetained(milestone, today)).toBe(true);
  });

  it(`drops a milestone ${String(TICKET_POST_FINAL_RETENTION_DAYS + 1)} days after its final day (boundary)`, () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-01');
    const today = tokyoCalendarDateSchema.parse('2026-03-09'); // 8 days after 2026-03-01
    expect(isTicketOpportunityPostFinalRetained(milestone, today)).toBe(false);
  });

  it('retains on the final day itself (day 0)', () => {
    const milestone = dateMilestone(1, 'application_close', '2026-03-01');
    const today = tokyoCalendarDateSchema.parse('2026-03-01');
    expect(isTicketOpportunityPostFinalRetained(milestone, today)).toBe(true);
  });
});

describe('buildTicketOpportunityTimelineRows', () => {
  it('flattens every milestone across opportunities into one chronological list', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          dateMilestone(1, 'application_open', '2026-03-05'),
          dateMilestone(2, 'application_close', '2026-03-10'),
        ],
        myState: 'planned',
      },
      {
        opportunityId: oppId(2),
        eventId,
        milestones: [dateMilestone(3, 'result_announcement', '2026-03-07')],
        myState: null,
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    expect(rows.map((row) => row.milestone.id)).toEqual([
      milestoneId(1), // 03-05
      milestoneId(3), // 03-07
      milestoneId(2), // 03-10
    ]);
  });

  it('marks exactly the chronologically-earliest row per opportunity as isFirstRowForOpportunity', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          dateMilestone(1, 'application_close', '2026-03-10'),
          dateMilestone(2, 'application_open', '2026-03-05'),
        ],
        myState: null,
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    const firstRows = rows.filter((row) => row.isFirstRowForOpportunity);
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0]?.milestone.id).toBe(milestoneId(2));
  });

  it('carries myState identically across every row of the same opportunity', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          dateMilestone(1, 'application_open', '2026-03-05'),
          dateMilestone(2, 'application_close', '2026-03-10'),
        ],
        myState: 'applied',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    expect(rows.every((row) => row.myState === 'applied')).toBe(true);
  });

  it('produces no rows for an opportunity the source gave no milestones for (never fabricates a placeholder row)', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      { opportunityId: oppId(1), eventId, milestones: [], myState: null },
    ];
    expect(buildTicketOpportunityTimelineRows(aggregates)).toEqual([]);
  });
});

describe('selectTicketOpportunityPrimaryRows - non-past preference', () => {
  const nowInstant = instantSchema.parse('2026-03-06T00:00:00Z');
  const today = tokyoCalendarDateSchema.parse('2026-03-06');

  it('selects the earliest non-past row when one exists', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          dateMilestone(1, 'application_open', '2026-03-01'), // past
          dateMilestone(2, 'application_close', '2026-03-10'), // non-past
          dateMilestone(3, 'result_announcement', '2026-03-20'), // non-past, later
        ],
        myState: 'planned',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.milestone.id).toBe(milestoneId(2));
    expect(primary[0]?.isPostFinalRetainedHistory).toBe(false);
  });

  it('drops an opportunity entirely once past the post-final retention window, even with no non-past row', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [dateMilestone(1, 'application_close', '2026-01-01')],
        myState: 'applied',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary).toEqual([]);
  });
});

describe('selectTicketOpportunityPrimaryRows - post-final retention boundary', () => {
  it('retains the final row exactly at the retention boundary (day 7)', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [dateMilestone(1, 'application_close', '2026-03-01')],
        myState: 'applied',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    const nowInstant = instantSchema.parse('2026-03-08T00:00:00Z');
    const today = tokyoCalendarDateSchema.parse('2026-03-08');
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.isPostFinalRetainedHistory).toBe(true);
    expect(primary[0]?.isFirstRowForOpportunity).toBe(true);
  });

  it('drops the final row the day after the retention boundary (day 8)', () => {
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [dateMilestone(1, 'application_close', '2026-03-01')],
        myState: 'applied',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    const nowInstant = instantSchema.parse('2026-03-09T00:00:00Z');
    const today = tokyoCalendarDateSchema.parse('2026-03-09');
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary).toEqual([]);
  });
});

describe('selectTicketOpportunityPrimaryRows - final row tracked by final day, not by sortInstant', () => {
  it('treats a window milestone as the final row when its endsAt is the latest final day, even though it sorts earlier by its own startsAt', () => {
    // The window sorts by startsAt (2026-03-01), earlier than the date
    // milestone (2026-03-05) - but its own final day (endsAt, 2026-03-20)
    // is the true latest final day for this opportunity. A naive
    // "last-scanned row" scan (by sortInstant order) would wrongly treat
    // the date milestone as final and compute retention from 2026-03-05,
    // not 2026-03-20.
    const aggregates: TicketOpportunityAggregate[] = [
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          windowMilestone(1, 'payment_window', '2026-03-01T00:00:00Z', '2026-03-20T00:00:00Z'),
          dateMilestone(2, 'application_close', '2026-03-05'),
        ],
        myState: 'applied',
      },
    ];
    const rows = buildTicketOpportunityTimelineRows(aggregates);
    // Both milestones are past; today is within 7 days of 2026-03-20 (the
    // window's real final day) but far past 7 days of 2026-03-05.
    const nowInstant = instantSchema.parse('2026-03-25T00:00:00Z');
    const today = tokyoCalendarDateSchema.parse('2026-03-25');
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary).toHaveLength(1);
    expect(primary[0]?.milestone.id).toBe(milestoneId(1));
    expect(primary[0]?.isPostFinalRetainedHistory).toBe(true);
  });
});

describe('selectTicketOpportunityPrimaryRows - result re-sorted chronologically', () => {
  it('returns a current/next row for one opportunity and a retained row for another, sorted together', () => {
    const currentAggregate: TicketOpportunityAggregate = {
      opportunityId: oppId(1),
      eventId,
      milestones: [dateMilestone(1, 'application_close', '2026-03-15')],
      myState: 'planned',
    };
    const retainedAggregate: TicketOpportunityAggregate = {
      opportunityId: oppId(2),
      eventId,
      milestones: [dateMilestone(2, 'application_close', '2026-03-01')],
      myState: 'applied',
    };
    const rows = buildTicketOpportunityTimelineRows([currentAggregate, retainedAggregate]);
    const nowInstant = instantSchema.parse('2026-03-06T00:00:00Z');
    const today = tokyoCalendarDateSchema.parse('2026-03-06');
    const primary = selectTicketOpportunityPrimaryRows(rows, nowInstant, today);
    expect(primary.map((row) => row.milestone.id)).toEqual([milestoneId(2), milestoneId(1)]);
    expect(primary[0]?.isPostFinalRetainedHistory).toBe(true);
    expect(primary[1]?.isPostFinalRetainedHistory).toBe(false);
  });
});

describe('groupTicketOpportunityTimelineRowsByMonth', () => {
  it('groups contiguous same-month rows into one bucket, in encounter order', () => {
    const rows = buildTicketOpportunityTimelineRows([
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [
          dateMilestone(1, 'application_open', '2026-03-01'),
          dateMilestone(2, 'application_close', '2026-03-10'),
        ],
        myState: null,
      },
      {
        opportunityId: oppId(2),
        eventId,
        milestones: [dateMilestone(3, 'sale_start', '2026-04-01')],
        myState: null,
      },
    ]);
    const groups = groupTicketOpportunityTimelineRowsByMonth(rows);
    expect(groups.map((group) => group.monthKey)).toEqual(['2026-03', '2026-04']);
    expect(groups[0]?.rows.map((row) => row.milestone.id)).toEqual([
      milestoneId(1),
      milestoneId(2),
    ]);
    expect(groups[1]?.rows.map((row) => row.milestone.id)).toEqual([milestoneId(3)]);
  });

  it('returns no groups for an empty row list', () => {
    expect(groupTicketOpportunityTimelineRowsByMonth([])).toEqual([]);
  });

  it('creates a new group when a later row reverts to an earlier-seen month (non-contiguous input is not merged)', () => {
    const marchRowA = buildTicketOpportunityTimelineRows([
      {
        opportunityId: oppId(1),
        eventId,
        milestones: [dateMilestone(1, 'application_open', '2026-03-01')],
        myState: null,
      },
    ])[0];
    const aprilRow = buildTicketOpportunityTimelineRows([
      {
        opportunityId: oppId(2),
        eventId,
        milestones: [dateMilestone(2, 'application_open', '2026-04-01')],
        myState: null,
      },
    ])[0];
    const marchRowB = buildTicketOpportunityTimelineRows([
      {
        opportunityId: oppId(3),
        eventId,
        milestones: [dateMilestone(3, 'application_open', '2026-03-15')],
        myState: null,
      },
    ])[0];
    if (marchRowA === undefined || aprilRow === undefined || marchRowB === undefined) {
      throw new Error(
        'unreachable: each buildTicketOpportunityTimelineRows call produces exactly one row',
      );
    }
    const groups = groupTicketOpportunityTimelineRowsByMonth([marchRowA, aprilRow, marchRowB]);
    expect(groups.map((group) => group.monthKey)).toEqual(['2026-03', '2026-04', '2026-03']);
  });
});
