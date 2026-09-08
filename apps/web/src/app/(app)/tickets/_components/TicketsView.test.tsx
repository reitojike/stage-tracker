import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockState } from "@/app/_lib/read-state";
import type { TicketsTimelineState } from "../_lib/tickets-loader";
import { TicketsView } from "./TicketsView";

function row(
  overrides: Partial<{
    myState: "planned" | "applied" | null;
    isPostFinalRetainedHistory: boolean;
  }> = {},
) {
  const { myState = null, isPostFinalRetainedHistory = false } = overrides;
  return {
    opportunityId: "44444444-4444-4444-8444-444444444444",
    eventId: "22222222-2222-4222-8222-222222222222",
    milestone: {
      id: "55555555-5555-4555-8555-555555555555",
      opportunityId: "44444444-4444-4444-8444-444444444444",
      milestoneType: "sale_start",
      temporalPrecision: "datetime",
      at: "2026-03-10T10:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    sortInstant: "2026-03-10T10:00:00.000Z",
    myState,
    isFirstRowForOpportunity: true,
    isPostFinalRetainedHistory,
  } as never;
}

const POPULATED: BlockState<TicketsTimelineState> = {
  variant: "populated",
  data: {
    groups: [{ monthKey: "2026-03", rows: [row({ myState: "applied" })] }],
  },
};

describe("TicketsView", () => {
  it("renders the empty state with the oracle's exact copy", () => {
    render(<TicketsView state={{ variant: "empty" }} />);
    expect(
      screen.getByText("現在表示できる抽選・販売スケジュールはありません"),
    ).toBeInTheDocument();
  });

  it("renders the error state as an alert", () => {
    render(<TicketsView state={{ variant: "error", message: "boom" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "チケット情報を読み込めませんでした",
    );
  });

  it("renders the unavailable state distinctly from error", () => {
    render(
      <TicketsView state={{ variant: "unavailable", message: "denied" }} />,
    );
    expect(
      screen.getByText("チケット情報を確認できません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("groups populated rows by month and shows the 申し込み済み badge", () => {
    render(<TicketsView state={POPULATED} />);
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
    expect(screen.getByText("申し込み済み")).toBeInTheDocument();
    expect(screen.getByText("販売開始")).toBeInTheDocument();
  });

  it("prioritizes 受付終了 over the personal planning-state badge", () => {
    render(
      <TicketsView
        state={{
          variant: "populated",
          data: {
            groups: [
              {
                monthKey: "2026-03",
                rows: [
                  row({ myState: "applied", isPostFinalRetainedHistory: true }),
                ],
              },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("受付終了")).toBeInTheDocument();
    expect(screen.queryByText("申し込み済み")).not.toBeInTheDocument();
  });
});
