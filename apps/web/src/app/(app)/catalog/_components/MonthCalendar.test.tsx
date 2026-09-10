import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import { buildCatalogMonthViewModel } from "../_lib/calendar-view-model";
import { MonthCalendar } from "./MonthCalendar";

function entry(
  overrides: Partial<{
    id: string;
    title: string;
    startsOn: string;
    endsOn: string;
    canceledAt: string | null;
  }> = {},
): EventCatalogEntry {
  const {
    id = "22222222-2222-4222-8222-222222222222",
    title = "テスト公演",
    startsOn = "2026-03-01",
    endsOn = "2026-03-01",
    canceledAt = null,
  } = overrides;
  return {
    event: {
      id,
      ownerId: "11111111-1111-4111-8111-111111111111",
      title,
      venue: null,
      sourceUrl: null,
      memo: null,
      startsOn,
      endsOn,
      canceledAt,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrences: [],
    classification: { eventId: id as never, genre: null, groupIds: [] },
  };
}

const MONTH = { year: 2026, month: 3 };

describe("MonthCalendar", () => {
  it("renders a 7-day weekday header and the accessible calendar landmark", () => {
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, [])}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    // No ARIA grid/row/gridcell roles on the day grid itself (codex review
    // 指摘 - see this component's own comment): the section landmark is
    // identified by its `aria-label` instead (implicit `region` role).
    expect(
      screen.getByRole("region", { name: "2026年3月のイベントカレンダー" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("日")[0]).toBeInTheDocument();
    expect(screen.getByText("土")).toBeInTheDocument();
  });

  it("renders a multi-day Event as a band with its title as visible text", () => {
    const entries = [
      entry({
        id: "multi",
        title: "多日程公演",
        startsOn: "2026-03-10",
        endsOn: "2026-03-12",
      }),
    ];
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, entries)}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    expect(screen.getByText("多日程公演")).toBeInTheDocument();
  });

  it("appends a text（not color-only）「（中止）」marker to a canceled multi-day Event's band", () => {
    const entries = [
      entry({
        id: "canceled",
        title: "中止公演",
        startsOn: "2026-03-10",
        endsOn: "2026-03-12",
        canceledAt: "2026-02-01T00:00:00.000Z",
      }),
    ];
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, entries)}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    expect(screen.getByText("中止公演（中止）")).toBeInTheDocument();
  });

  it('marks only the today cell with aria-current="date" (WAI-ARIA semantics: not the selected day - ChatGPT review 指摘)', () => {
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, [])}
        selectedDate={"2026-03-20" as never}
        today={"2026-03-10" as never}
      />,
    );
    const todayLink = screen.getByRole("link", { name: /3月10日、今日/ });
    expect(todayLink).toHaveAttribute("aria-current", "date");
    const selectedLink = screen.getByRole("link", { name: /3月20日/ });
    expect(selectedLink).not.toHaveAttribute("aria-current", "date");
  });

  it("still applies the holiday's bold weight when today itself is a holiday (codex review 指摘: a prior revision let the today treatment fully replace the holiday's visible cue)", () => {
    // 2026-01-01 (元日) is a fixed national holiday in the snapshot.
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel({ year: 2026, month: 1 }, [])}
        selectedDate={null}
        today={"2026-01-01" as never}
      />,
    );
    const todayHolidayLink = screen.getByRole("link", {
      name: /1月1日、今日、祝日/,
    });
    const dayNumberSpan = todayHolidayLink.querySelector("span");
    expect(dayNumberSpan?.className).toContain("font-semibold");
    expect(dayNumberSpan?.className).toContain("bg-primary");
  });

  it("shows a week-overflow summary linking to every Event pushed past the 2-band lane cap", () => {
    const entries = [
      entry({
        id: "a",
        title: "第一公演",
        startsOn: "2026-03-01",
        endsOn: "2026-03-07",
      }),
      entry({
        id: "b",
        title: "第二公演",
        startsOn: "2026-03-01",
        endsOn: "2026-03-07",
      }),
      entry({
        id: "c",
        title: "第三公演",
        startsOn: "2026-03-01",
        endsOn: "2026-03-07",
      }),
    ];
    render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, entries)}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    expect(screen.getByText("この週にほか1件：")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "第三公演" })).toBeInTheDocument();
  });

  it("shows the month-level unconfirmed-holiday-coverage note only when applicable", () => {
    const { rerender } = render(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel(MONTH, [])}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    rerender(
      <MonthCalendar
        viewModel={buildCatalogMonthViewModel({ year: 2030, month: 1 }, [])}
        selectedDate={null}
        today={"2026-03-01" as never}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(
      "祝日データの公表範囲外です",
    );
  });
});
