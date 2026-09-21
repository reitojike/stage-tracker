import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalendarSkeleton } from "./CalendarSkeleton";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
}));

const props = {
  sectionLabel: "イベントカレンダー",
  fallbackLabel: "カレンダーを読み込めません",
};

describe("CalendarSkeleton", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams();
  });

  it("uses the existing month formatter for a valid month param", () => {
    mocks.searchParams = new URLSearchParams("month=2026-03");

    render(<CalendarSkeleton {...props} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute(
      "aria-label",
      "2026年3月のイベントカレンダーを読み込み中",
    );
    expect(within(status).getByText("2026年3月")).toBeInTheDocument();
  });

  it("resolves the month from a valid date param", () => {
    mocks.searchParams = new URLSearchParams("month=2026-04&date=2026-03-10");

    render(<CalendarSkeleton {...props} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute(
      "aria-label",
      "2026年3月のイベントカレンダーを読み込み中",
    );
    expect(within(status).getByText("2026年3月")).toBeInTheDocument();
  });
});
