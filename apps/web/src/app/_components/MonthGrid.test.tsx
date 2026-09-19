import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { buildMonthGridDays } from "@/app/_lib/calendar-grid";
import { calendarDayRole } from "@/app/_lib/calendar-day-role";
import { MonthGrid, MonthGridDayLink } from "./MonthGrid";

const MONTH = { year: 2026, month: 3 };

function weeks() {
  const days = buildMonthGridDays(MONTH);
  return Array.from({ length: days.length / 7 }, (_, weekIndex) => ({
    days: days.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => ({
      date,
      inCurrentMonth: date.slice(0, 7) === "2026-03",
      role: calendarDayRole(date),
    })),
  }));
}

describe("MonthGrid", () => {
  it("keeps shared weekday, today, selected, adjacent-month, and holiday cues", () => {
    const viewWeeks = weeks();
    render(
      <MonthGrid
        ariaLabel="2026年3月のカレンダー"
        weeks={viewWeeks}
        hasUnconfirmedHolidayCoverage={false}
        renderDay={(day, columnIndex) => {
          const isToday =
            day.date === tokyoCalendarDateSchema.parse("2026-03-20");
          return (
            <MonthGridDayLink
              key={day.date}
              {...day}
              columnIndex={columnIndex}
              href={`/calendar?date=${day.date}`}
              ariaLabel={`${day.date}${isToday ? "、今日" : ""}${day.role === "holiday" ? "、祝日" : day.role === "saturday" ? "、土曜日" : day.role === "sunday" ? "、日曜日" : ""}`}
              isToday={isToday}
              isSelected={
                day.date === tokyoCalendarDateSchema.parse("2026-03-21")
              }
            />
          );
        }}
        renderWeekOverlays={() => null}
      />,
    );

    expect(screen.getByText("日")).toBeInTheDocument();
    expect(screen.getByText("土")).toBeInTheDocument();
    expect(
      screen
        .getByRole("link", { name: "2026-03-01、日曜日" })
        .querySelector("span"),
    ).toHaveClass("text-calendar-sunday");
    expect(
      screen
        .getByRole("link", { name: "2026-03-07、土曜日" })
        .querySelector("span"),
    ).toHaveClass("text-calendar-saturday");
    const holidayToday = screen.getByRole("link", {
      name: "2026-03-20、今日、祝日",
    });
    expect(holidayToday).toHaveAttribute("aria-current", "date");
    expect(holidayToday.querySelector("span")).toHaveClass(
      "bg-primary",
      "font-semibold",
    );
    expect(
      screen.getByRole("link", { name: "2026-03-21、土曜日" }),
    ).toHaveClass("border-primary", "bg-muted");
    expect(screen.getByRole("link", { name: "2026-04-01" })).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("renders the holiday coverage notice as a shared month-level note", () => {
    render(
      <MonthGrid
        ariaLabel="2030年1月のカレンダー"
        weeks={weeks()}
        hasUnconfirmedHolidayCoverage={true}
        renderDay={() => null}
        renderWeekOverlays={() => null}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      "祝日データの公表範囲外です",
    );
  });
});
