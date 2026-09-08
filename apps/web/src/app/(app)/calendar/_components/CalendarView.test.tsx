import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockState } from "@/app/_lib/read-state";
import type {
  CalendarOccurrenceItem,
  CalendarScheduleItem,
  TokyoDateIndex,
} from "../_lib/calendar-loader";
import { CalendarView } from "./CalendarView";

const MONTH = { year: 2026, month: 3 };
const TODAY = "2026-03-05" as never;

const EMPTY_OCCURRENCES: BlockState<TokyoDateIndex<CalendarOccurrenceItem>> = {
  variant: "empty",
};
const EMPTY_SCHEDULE: BlockState<TokyoDateIndex<CalendarScheduleItem>> = {
  variant: "empty",
};

function occurrenceIndex(date: string): TokyoDateIndex<CalendarOccurrenceItem> {
  const item: CalendarOccurrenceItem = {
    participation: {
      id: "66666666-6666-4666-8666-666666666666",
      occurrenceId: "33333333-3333-4333-8333-333333333333",
      userId: "11111111-1111-4111-8111-111111111111",
      status: "attending",
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrence: {
      id: "33333333-3333-4333-8333-333333333333",
      eventId: "22222222-2222-4222-8222-222222222222",
      doorsAt: null,
      startsAt: `${date}T10:00:00.000Z`,
      endsAt: null,
      canceledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    event: {
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      title: "テスト公演",
      venue: null,
      sourceUrl: null,
      memo: null,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      canceledAt: null,
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
        occurrenceState={{ variant: "error", message: "boom" }}
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
        occurrenceState={{ variant: "unavailable", message: "denied" }}
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

  it("restricts the day-detail view to the selected date only", () => {
    render(
      <CalendarView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-16" as never}
        occurrenceState={{
          variant: "populated",
          data: occurrenceIndex("2026-03-15"),
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.getByText("この日の参加予定はありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText("テスト公演")).not.toBeInTheDocument();
  });
});
