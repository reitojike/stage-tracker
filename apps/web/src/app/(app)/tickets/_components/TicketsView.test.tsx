import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OptionalPartBlockState } from "@/app/_lib/read-state";
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

const POPULATED: OptionalPartBlockState<TicketsTimelineState> = {
  block: {
    variant: "populated",
    data: {
      groups: [{ monthKey: "2026-03", rows: [row({ myState: "applied" })] }],
    },
  },
  optional: { ok: true },
};

describe("TicketsView", () => {
  it("renders the empty state with the oracle's exact copy", () => {
    render(
      <TicketsView
        state={{ block: { variant: "empty" }, optional: { ok: true } }}
      />,
    );
    expect(
      screen.getByText("現在表示できる抽選・販売スケジュールはありません"),
    ).toBeInTheDocument();
  });

  it("renders the error state as an alert with a generic retry hint (never a raw message)", () => {
    render(
      <TicketsView
        state={{ block: { variant: "error" }, optional: { ok: true } }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "チケット情報を読み込めませんでした",
    );
    expect(
      screen.getByText("しばらくしてから再度お試しください。"),
    ).toBeInTheDocument();
  });

  it("renders the unavailable state distinctly from error", () => {
    render(
      <TicketsView
        state={{ block: { variant: "unavailable" }, optional: { ok: true } }}
      />,
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
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [
                    row({
                      myState: "applied",
                      isPostFinalRetainedHistory: true,
                    }),
                  ],
                },
              ],
            },
          },
          optional: { ok: true },
        }}
      />,
    );
    expect(screen.getByText("受付終了")).toBeInTheDocument();
    expect(screen.queryByText("申し込み済み")).not.toBeInTheDocument();
  });

  /**
   * PR #381 P4 follow-up review finding 2: the shared timeline (`block`)
   * must keep rendering even when the personal-state read (`optional`)
   * failed, and the per-row badge must say "不明" rather than silently
   * disappearing - "不明" and "no personal state for this row" must not be
   * the same rendered output.
   */
  it("renders every badge as 不明, not omitted, when the personal-state read fails, while the shared timeline still renders", () => {
    render(
      <TicketsView
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [row({ myState: "applied" })],
                },
              ],
            },
          },
          optional: { ok: false, variant: "error" },
        }}
      />,
    );

    expect(screen.getByText("2026年3月")).toBeInTheDocument();
    expect(screen.getByText("販売開始")).toBeInTheDocument();
    expect(screen.getByText("不明")).toBeInTheDocument();
    expect(screen.queryByText("申し込み済み")).not.toBeInTheDocument();
    expect(
      screen.getByText("申し込み状態を取得できませんでした"),
    ).toBeInTheDocument();
  });

  it("still shows 受付終了 (not 不明) for post-final rows even when the personal-state read fails", () => {
    render(
      <TicketsView
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [
                    row({
                      myState: "applied",
                      isPostFinalRetainedHistory: true,
                    }),
                  ],
                },
              ],
            },
          },
          optional: { ok: false, variant: "unavailable" },
        }}
      />,
    );

    expect(screen.getByText("受付終了")).toBeInTheDocument();
    expect(screen.queryByText("不明")).not.toBeInTheDocument();
    expect(
      screen.getByText("申し込み状態を確認できません"),
    ).toBeInTheDocument();
  });

  it("does not show the personal-state failure note when the optional read succeeds", () => {
    render(<TicketsView state={POPULATED} />);
    expect(
      screen.queryByText("申し込み状態を取得できませんでした"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("申し込み状態を確認できません"),
    ).not.toBeInTheDocument();
  });
});
