import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { userIdSchema } from "@stage-tracker/domain";
import type { BlockState } from "@/app/_lib/read-state";
import type {
  CalendarOccurrenceItem,
  CalendarScheduleItem,
  TokyoDateIndex,
} from "../_lib/calendar-loader";
import { CalendarView } from "./CalendarView";

const MONTH = { year: 2026, month: 3 };
const TODAY = "2026-03-05" as never;
const USER_ID = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID = userIdSchema.parse(
  "99999999-9999-4999-8999-999999999999",
);

const EMPTY_OCCURRENCES: BlockState<TokyoDateIndex<CalendarOccurrenceItem>> = {
  variant: "empty",
};
const EMPTY_SCHEDULE: BlockState<TokyoDateIndex<CalendarScheduleItem>> = {
  variant: "empty",
};

function occurrenceIndex(
  date: string,
  {
    status = "attending",
    eventCanceledAt = null,
    occurrenceCanceledAt = null,
    venue = null,
  }: {
    readonly status?: "attending" | "considering";
    readonly eventCanceledAt?: string | null;
    readonly occurrenceCanceledAt?: string | null;
    readonly venue?: string | null;
  } = {},
): TokyoDateIndex<CalendarOccurrenceItem> {
  const item: CalendarOccurrenceItem = {
    participation: {
      id: "66666666-6666-4666-8666-666666666666",
      occurrenceId: "33333333-3333-4333-8333-333333333333",
      userId: "11111111-1111-4111-8111-111111111111",
      status,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrence: {
      id: "33333333-3333-4333-8333-333333333333",
      eventId: "22222222-2222-4222-8222-222222222222",
      doorsAt: null,
      startsAt: `${date}T10:00:00.000Z`,
      endsAt: `${date}T12:00:00.000Z`,
      canceledAt: occurrenceCanceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    event: {
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      title: "テスト公演",
      venue,
      sourceUrl: null,
      memo: null,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      canceledAt: eventCanceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
  };
  return { items: [item], byDate: new Map([[date as never, [item]]]) };
}

function scheduleIndex(
  date = "2026-03-15",
  {
    ownerId = USER_ID,
    blocking = true,
    memo = null,
    title = "テスト予定",
  }: {
    readonly ownerId?: typeof USER_ID;
    readonly blocking?: boolean;
    readonly memo?: string | null;
    readonly title?: string;
  } = {},
): TokyoDateIndex<CalendarScheduleItem> {
  const item: CalendarScheduleItem = {
    entry: {
      id: "77777777-7777-4777-8777-777777777777",
      ownerId,
      title,
      memo,
      blocking,
      temporal: {
        kind: "all-day",
        startsOn: date as never,
        endsOn: date as never,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
  };
  return { items: [item], byDate: new Map([[date as never, [item]]]) };
}

describe("CalendarView", () => {
  it("shows one merged empty panel with an add-schedule action when both blocks are empty", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={EMPTY_OCCURRENCES}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("この月の予定はありません")).toBeInTheDocument();
    expect(screen.getByText("+ 予定を追加")).toBeInTheDocument();
  });

  it("renders 参加予定's own error panel while 個人の予定 still renders its own state (P4)", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{ variant: "error" }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "参加予定を読み込めませんでした",
    );
    expect(screen.getByText("個人の予定はありません")).toBeInTheDocument();
  });

  it("renders the unavailable variant distinctly from error", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{ variant: "unavailable" }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("参加予定を確認できません")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("groups a populated occurrence under its own date in month agenda view", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    expect(screen.getByText("3月15日(日)")).toBeInTheDocument();
  });

  it("merges an empty selected day even when another day has data", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-16" as never}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.getByText("この日の予定はまだありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "3月16日に予定を追加" }),
    ).toHaveAttribute("href", "/schedule/new?date=2026-03-16");
    expect(
      screen.queryByText("この日の参加予定はありません"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("この日の個人の予定はありません"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("テスト公演")).not.toBeInTheDocument();
  });

  it("scopes the month empty state to the actual month, not adjacent grid days", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-04-01"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("この月の予定はありません")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "+ 予定を追加" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("この月の参加予定はありません"),
    ).not.toBeInTheDocument();
  });

  it("uses aria-current only for today and avoids incomplete grid roles", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-15" as never}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.getByRole("link", { name: /2026年3月5日、今日/ }),
    ).toHaveAttribute("aria-current", "date");
    expect(
      screen.getByRole("link", { name: /2026年3月15日/ }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("keeps holiday and today cues together while selected styling remains separate", () => {
    render(
      <CalendarView
        month={MONTH}
        today={"2026-03-20" as never}
        selectedDate={"2026-03-20" as never}
        userId={USER_ID}
        occurrenceState={EMPTY_OCCURRENCES}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    const holiday = screen.getByRole("link", {
      name: /2026年3月20日、今日、祝日/,
    });
    expect(holiday).toHaveAttribute("aria-current", "date");
    expect(holiday.className).toContain("border-primary");
    expect(holiday.querySelector("span")?.className).toContain("font-semibold");
  });

  it("shows a month-level holiday coverage notice without per-cell unknown glyphs", () => {
    render(
      <CalendarView
        month={{ year: 2030, month: 1 }}
        today={"2030-01-01" as never}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={EMPTY_OCCURRENCES}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "この月の一部の日付は祝日データの公表範囲外です",
    );
    expect(screen.queryByText("?")).not.toBeInTheDocument();
  });

  it("renders selected-day occurrence and schedule details with their canonical fields", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-15" as never}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15", {
            eventCanceledAt: "2026-02-01T00:00:00.000Z",
            venue: "東京会場",
          }),
        }}
        scheduleState={{
          variant: "populated",
          data: scheduleIndex("2026-03-15", {
            ownerId: OTHER_USER_ID,
            blocking: false,
            memo: "共有メモ",
          }),
        }}
      />,
    );

    expect(screen.getByText("19:00〜21:00")).toBeInTheDocument();
    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    expect(screen.getByText("東京会場")).toBeInTheDocument();
    expect(
      screen.getByText("参加する", { selector: '[data-slot="badge"]' }),
    ).toBeInTheDocument();
    expect(screen.getByText("中止")).toBeInTheDocument();
    expect(screen.getByText("共有されている予定")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2026年3月15日.*共有されている予定1件/ })).toBeInTheDocument();
    expect(
      screen.getByText("予定を確保しない", {
        selector: '[data-slot="badge"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("3月15日(日)（終日）")).toBeInTheDocument();
    expect(screen.getByText("共有メモ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /テスト公演/ })).toHaveAttribute(
      "href",
      "/catalog/events/22222222-2222-4222-8222-222222222222?month=2026-03&date=2026-03-15&occurrence=33333333-3333-4333-8333-333333333333",
    );
    expect(screen.getByRole("link", { name: /テスト予定/ })).toHaveAttribute(
      "href",
      "/schedule/77777777-7777-4777-8777-777777777777?month=2026-03",
    );
  });

  it("keeps the selected-day add action date-specific when the day is empty", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-16" as never}
        userId={USER_ID}
        occurrenceState={EMPTY_OCCURRENCES}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.getByRole("link", { name: "3月16日に予定を追加" }),
    ).toHaveAttribute("href", "/schedule/new?date=2026-03-16");
  });

  it("keeps the populated occurrence block visible when the schedule read fails", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={{ variant: "error" }}
      />,
    );

    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "個人の予定を読み込めませんでした",
    );
  });

  it("keeps the populated schedule block visible when the occurrence read fails", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{ variant: "error" }}
        scheduleState={{
          variant: "populated",
          data: scheduleIndex(),
        }}
      />,
    );

    expect(screen.getByText("テスト予定")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "参加予定を読み込めませんでした",
    );
  });

  it("keeps an actual empty block distinct from a populated sibling", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={EMPTY_OCCURRENCES}
        scheduleState={{
          variant: "populated",
          data: scheduleIndex(),
        }}
      />,
    );

    expect(screen.getByText("参加予定はありません")).toBeInTheDocument();
    expect(screen.getByText("テスト予定")).toBeInTheDocument();
  });

  it("keeps an actual empty schedule block distinct from a populated occurrence sibling", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        userId={USER_ID}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    expect(screen.getByText("個人の予定はありません")).toBeInTheDocument();
  });
});
