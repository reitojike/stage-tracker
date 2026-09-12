import {
  instantToTokyoCalendarDate,
  userIdSchema,
  type PersonalScheduleEntry,
  type TokyoCalendarDate,
  type UserId,
} from "@stage-tracker/domain";
import { describe, expect, it } from "vitest";
import { calendarDayRole } from "@/app/_lib/calendar-day-role";
import type {
  CalendarOccurrenceItem,
  CalendarScheduleItem,
  TokyoDateIndex,
} from "./calendar-loader";
import {
  buildMyCalendarMonthViewModel,
  buildMyCalendarScheduleBandSegments,
  calendarScheduleDateRange,
  scheduleEntryDatesInRange,
  selectCalendarOccurrenceItems,
  selectCalendarMonthScheduleGroups,
  selectCalendarScheduleItems,
} from "./calendar-view-model";

const USER_ID = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
const DATE = (value: string): TokyoCalendarDate => value as never;
const INSTANT = (value: string) => value as never;

function occurrenceItem({
  id = "33333333-3333-4333-8333-333333333333",
  date = "2026-03-05",
  status = "attending",
  eventCanceledAt = null,
  occurrenceCanceledAt = null,
}: {
  readonly id?: string;
  readonly date?: string;
  readonly status?: "attending" | "considering";
  readonly eventCanceledAt?: string | null;
  readonly occurrenceCanceledAt?: string | null;
} = {}): CalendarOccurrenceItem {
  return {
    participation: {
      id: `66666666-6666-4666-8666-${id.slice(-12)}`,
      occurrenceId: id,
      userId: USER_ID,
      status,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    occurrence: {
      id,
      eventId: "22222222-2222-4222-8222-222222222222",
      doorsAt: null,
      startsAt: `${date}T10:00:00.000Z`,
      endsAt: `${date}T12:00:00.000Z`,
      canceledAt: occurrenceCanceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    event: {
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: USER_ID,
      title: "テスト公演",
      venue: "テスト会場",
      sourceUrl: null,
      memo: null,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      canceledAt: eventCanceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  } as never;
}

function occurrenceIndex(
  items: readonly CalendarOccurrenceItem[],
): TokyoDateIndex<CalendarOccurrenceItem> {
  const byDate = new Map<TokyoCalendarDate, CalendarOccurrenceItem[]>();
  for (const item of items) {
    const date = instantToTokyoCalendarDate(item.occurrence.startsAt);
    const bucket = byDate.get(date);
    if (bucket === undefined) {
      byDate.set(date, [item]);
    } else {
      bucket.push(item);
    }
  }
  return { items, byDate };
}

function scheduleItem({
  id = "77777777-7777-4777-8777-777777777777",
  ownerId = USER_ID,
  title = "予定",
  blocking = true,
  temporal = {
    kind: "all-day",
    startsOn: DATE("2026-03-05"),
    endsOn: DATE("2026-03-05"),
  },
  memo = null,
}: {
  readonly id?: string;
  readonly ownerId?: UserId;
  readonly title?: string;
  readonly blocking?: boolean;
  readonly temporal?: PersonalScheduleEntry["temporal"];
  readonly memo?: string | null;
} = {}): CalendarScheduleItem {
  return {
    entry: {
      id,
      ownerId,
      title,
      memo,
      blocking,
      temporal,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  } as never;
}

function scheduleIndex(
  items: readonly CalendarScheduleItem[],
  gridStart = DATE("2026-01-25"),
  gridEnd = DATE("2026-04-04"),
): TokyoDateIndex<CalendarScheduleItem> {
  const byDate = new Map<TokyoCalendarDate, CalendarScheduleItem[]>();
  for (const item of items) {
    for (const date of scheduleEntryDatesInRange(
      item.entry,
      gridStart,
      gridEnd,
    )) {
      const bucket = byDate.get(date);
      if (bucket === undefined) {
        byDate.set(date, [item]);
      } else {
        bucket.push(item);
      }
    }
  }
  return { items, byDate };
}

const EMPTY_OCCURRENCE_INDEX: TokyoDateIndex<CalendarOccurrenceItem> = {
  items: [],
  byDate: new Map(),
};

const EMPTY_SCHEDULE_INDEX: TokyoDateIndex<CalendarScheduleItem> = {
  items: [],
  byDate: new Map(),
};

function dayAt(
  month: { readonly year: number; readonly month: number },
  date: string,
  occurrences: readonly CalendarOccurrenceItem[] = [],
  schedules: readonly CalendarScheduleItem[] = [],
) {
  const viewModel = buildMyCalendarMonthViewModel(
    month,
    occurrenceIndex(occurrences),
    scheduleIndex(schedules),
    USER_ID,
  );
  return viewModel.weeks
    .flatMap((week) => week.days)
    .find((day) => day.date === date);
}

describe("My Calendar marker projection", () => {
  it.each([
    ["active attending occurrence", "filled", [occurrenceItem()]],
    [
      "considering occurrence only",
      "outline",
      [occurrenceItem({ status: "considering" })],
    ],
    [
      "attending and considering occurrences",
      "filled",
      [
        occurrenceItem({ id: "33333333-3333-4333-8333-333333333333" }),
        occurrenceItem({
          id: "44444444-4444-4444-8444-444444444444",
          status: "considering",
        }),
      ],
    ],
  ])("uses %s -> %s", (_caseName, expected, items) => {
    expect(dayAt({ year: 2026, month: 3 }, "2026-03-05", items)?.dot).toBe(
      expected,
    );
  });

  it.each([
    ["blocking single-day schedule", "filled", true],
    ["non-blocking single-day schedule", "outline", false],
  ])("uses %s -> %s", (_caseName, expected, blocking) => {
    const item = scheduleItem({ blocking });
    expect(dayAt({ year: 2026, month: 3 }, "2026-03-05", [], [item])?.dot).toBe(
      expected,
    );
  });

  it("gives filled precedence to blocking over non-blocking schedules", () => {
    const items = [
      scheduleItem({
        id: "77777777-7777-4777-8777-777777777777",
        blocking: false,
      }),
      scheduleItem({
        id: "88888888-8888-4888-8888-888888888888",
        blocking: true,
      }),
    ];
    expect(dayAt({ year: 2026, month: 3 }, "2026-03-05", [], items)?.dot).toBe(
      "filled",
    );
  });

  it("excludes event-level and occurrence-level canceled occurrences from dots and counts", () => {
    const items = [
      occurrenceItem({
        id: "33333333-3333-4333-8333-333333333333",
        eventCanceledAt: "2026-02-01T00:00:00.000Z",
      }),
      occurrenceItem({
        id: "44444444-4444-4444-8444-444444444444",
        status: "considering",
        occurrenceCanceledAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    const day = dayAt({ year: 2026, month: 3 }, "2026-03-05", items);
    expect(day).toMatchObject({
      dot: "none",
      attendingCount: 0,
      consideringCount: 0,
    });
  });

  it("keeps canceled occurrences available to selected-day detail selection", () => {
    const canceled = occurrenceItem({
      eventCanceledAt: "2026-02-01T00:00:00.000Z",
    });
    expect(
      selectCalendarOccurrenceItems(
        occurrenceIndex([canceled]),
        DATE("2026-03-05"),
      ),
    ).toEqual([canceled]);
  });
});

describe("My Calendar schedule date projection", () => {
  it("sorts schedule rows chronologically within the same date group", () => {
    const later = scheduleItem({
      id: "88888888-8888-4888-8888-888888888888",
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T10:00:00.000Z"),
        endsAt: null,
      },
    });
    const earlier = scheduleItem({
      id: "77777777-7777-4777-8777-777777777777",
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T01:00:00.000Z"),
        endsAt: null,
      },
    });
    const groups = selectCalendarMonthScheduleGroups(
      scheduleIndex([later, earlier]),
      { year: 2026, month: 3 },
      USER_ID,
    );
    expect(groups[0]?.items.map((item) => item.entry.id)).toEqual([
      earlier.entry.id,
      later.entry.id,
    ]);
    expect(
      selectCalendarScheduleItems(
        scheduleIndex([later, earlier]),
        USER_ID,
        DATE("2026-03-05"),
      ).map((item) => item.entry.id),
    ).toEqual([earlier.entry.id, later.entry.id]);
  });

  it("keeps single-day and multi-day all-day ranges inclusive", () => {
    const single = scheduleItem({
      temporal: {
        kind: "all-day",
        startsOn: DATE("2026-03-05"),
        endsOn: DATE("2026-03-05"),
      },
    });
    const multi = scheduleItem({
      temporal: {
        kind: "all-day",
        startsOn: DATE("2026-03-05"),
        endsOn: DATE("2026-03-07"),
      },
    });
    expect(calendarScheduleDateRange(single.entry)).toEqual({
      startDate: "2026-03-05",
      endDate: "2026-03-05",
    });
    expect(
      scheduleEntryDatesInRange(
        multi.entry,
        DATE("2026-03-01"),
        DATE("2026-03-31"),
      ),
    ).toEqual(["2026-03-05", "2026-03-06", "2026-03-07"]);
  });

  it("uses Tokyo dates for same-day, overnight, and longer time-bounded entries", () => {
    const sameDay = scheduleItem({
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T00:00:00.000Z"),
        endsAt: INSTANT("2026-03-05T08:59:00.000Z"),
      },
    });
    const overnight = scheduleItem({
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T14:00:00.000Z"),
        endsAt: INSTANT("2026-03-06T00:00:00.000Z"),
      },
    });
    const long = scheduleItem({
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T00:00:00.000Z"),
        endsAt: INSTANT("2026-03-07T14:00:00.000Z"),
      },
    });
    const open = scheduleItem({
      temporal: {
        kind: "time-bounded",
        startsAt: INSTANT("2026-03-05T14:00:00.000Z"),
        endsAt: null,
      },
    });

    expect(calendarScheduleDateRange(sameDay.entry)).toMatchObject({
      startDate: "2026-03-05",
      endDate: "2026-03-05",
    });
    expect(
      scheduleEntryDatesInRange(
        overnight.entry,
        DATE("2026-03-01"),
        DATE("2026-03-31"),
      ),
    ).toEqual(["2026-03-05", "2026-03-06"]);
    expect(
      scheduleEntryDatesInRange(
        long.entry,
        DATE("2026-03-01"),
        DATE("2026-03-31"),
      ),
    ).toEqual(["2026-03-05", "2026-03-06", "2026-03-07"]);
    expect(
      scheduleEntryDatesInRange(
        open.entry,
        DATE("2026-03-01"),
        DATE("2026-03-31"),
      ),
    ).toEqual(["2026-03-05"]);
  });

  it("clips a schedule to the visible grid without changing its own range", () => {
    const item = scheduleItem({
      temporal: {
        kind: "all-day",
        startsOn: DATE("2026-01-29"),
        endsOn: DATE("2026-02-03"),
      },
    });
    expect(
      scheduleEntryDatesInRange(
        item.entry,
        DATE("2026-01-31"),
        DATE("2026-02-02"),
      ),
    ).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(calendarScheduleDateRange(item.entry)).toEqual({
      startDate: "2026-01-29",
      endDate: "2026-02-03",
    });
  });
});

describe("My Calendar schedule bands", () => {
  it("preserves blocking fill and non-blocking outline semantics", () => {
    const segments = buildMyCalendarScheduleBandSegments([
      scheduleItem({
        id: "77777777-7777-4777-8777-777777777777",
        blocking: true,
        temporal: {
          kind: "all-day",
          startsOn: DATE("2026-03-05"),
          endsOn: DATE("2026-03-06"),
        },
      }),
      scheduleItem({
        id: "88888888-8888-4888-8888-888888888888",
        blocking: false,
        temporal: {
          kind: "all-day",
          startsOn: DATE("2026-03-05"),
          endsOn: DATE("2026-03-06"),
        },
      }),
    ]);
    expect(segments.map((segment) => segment.blocking)).toEqual([true, false]);
    expect(segments.every((segment) => segment.kind === "schedule")).toBe(true);
  });

  it("splits a cross-week band and keeps a cross-month lead-cell band reachable", () => {
    const crossWeek = scheduleItem({
      id: "77777777-7777-4777-8777-777777777777",
      temporal: {
        kind: "all-day",
        startsOn: DATE("2026-02-05"),
        endsOn: DATE("2026-02-12"),
      },
    });
    const crossMonth = scheduleItem({
      id: "88888888-8888-4888-8888-888888888888",
      temporal: {
        kind: "all-day",
        startsOn: DATE("2026-01-30"),
        endsOn: DATE("2026-02-02"),
      },
    });
    const viewModel = buildMyCalendarMonthViewModel(
      { year: 2026, month: 2 },
      EMPTY_OCCURRENCE_INDEX,
      scheduleIndex([crossWeek, crossMonth]),
      USER_ID,
    );
    const crossWeekLayouts = viewModel.weeks.filter((week) =>
      week.bandLayout.segments.some(
        (segment) => segment.eventId === crossWeek.entry.id,
      ),
    );
    expect(crossWeekLayouts).toHaveLength(2);
    expect(
      viewModel.weeks.some((week) =>
        week.bandLayout.segments.some(
          (segment) =>
            segment.eventId === crossMonth.entry.id &&
            segment.startDate === "2026-01-30",
        ),
      ),
    ).toBe(true);
  });

  it("caps each week at MAX_BAND_LANES and exposes canonical overflow links data", () => {
    const items = [1, 2, 3].map((number) =>
      scheduleItem({
        id: `77777777-7777-4777-8777-77777777777${number}`,
        title: `重複予定${String(number)}`,
        temporal: {
          kind: "all-day",
          startsOn: DATE("2026-02-10"),
          endsOn: DATE("2026-02-12"),
        },
      }),
    );
    const viewModel = buildMyCalendarMonthViewModel(
      { year: 2026, month: 2 },
      EMPTY_OCCURRENCE_INDEX,
      scheduleIndex(items),
      USER_ID,
    );
    const week = viewModel.weeks.find((candidate) =>
      candidate.days.some((day) => day.date === "2026-02-10"),
    );
    expect(week?.bandLayout.segments).toHaveLength(2);
    expect(week?.bandLayout.overflowCount).toBe(1);
    expect(week?.bandLayout.overflowEvents[0]?.eventId).toBe(
      items[2]?.entry.id,
    );
  });
});

describe("My Calendar calendar-day roles", () => {
  it("distinguishes Saturday, Sunday, holiday, and holiday-over-Saturday", () => {
    expect(calendarDayRole(DATE("2026-03-21"))).toBe("saturday");
    expect(calendarDayRole(DATE("2026-03-22"))).toBe("sunday");
    expect(calendarDayRole(DATE("2026-03-20"))).toBe("holiday");
    // 1955-01-01 is both a Saturday and a snapshot-backed holiday.
    expect(calendarDayRole(DATE("1955-01-01"))).toBe("holiday");
  });

  it("uses a month-level notice when the holiday snapshot does not cover the month", () => {
    expect(
      buildMyCalendarMonthViewModel(
        { year: 2030, month: 1 },
        EMPTY_OCCURRENCE_INDEX,
        EMPTY_SCHEDULE_INDEX,
        USER_ID,
      ).hasUnconfirmedHolidayCoverage,
    ).toBe(true);
    expect(
      buildMyCalendarMonthViewModel(
        { year: 2026, month: 3 },
        EMPTY_OCCURRENCE_INDEX,
        EMPTY_SCHEDULE_INDEX,
        USER_ID,
      ).hasUnconfirmedHolidayCoverage,
    ).toBe(false);
  });
});
