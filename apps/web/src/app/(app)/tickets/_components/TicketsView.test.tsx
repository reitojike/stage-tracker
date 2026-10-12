import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatMilestoneTypeJa } from "@/app/_lib/ticket-milestone-format";
import {
  eventIdSchema,
  instantSchema,
  ticketOpportunityIdSchema,
  ticketOpportunityMilestoneIdSchema,
  ticketOpportunityMilestoneSchema,
  tokyoCalendarDateSchema,
  type TicketOpportunityMilestone,
} from "@stage-tracker/domain";
import type { OptionalPartBlockState } from "@/app/_lib/read-state";
import type { TicketsTimelineState } from "../_lib/tickets-loader";
import { TicketsView } from "./TicketsView";

const TODAY = tokyoCalendarDateSchema.parse("2026-03-01");

// `TicketOpportunityStateControls` (rendered per row) imports the
// `"use server"` action, which transitively pulls in `src/env.ts` - not
// available/valid in this unit test's environment. Mock it out the same way
// `ParticipationControls.test.tsx` mocks `participation.actions`.
vi.mock("@/lib/actions/ticketOpportunityState.actions", () => ({
  updateTicketOpportunityStateAction: vi.fn(),
}));

function row(
  overrides: Partial<{
    myState: "planned" | "applied" | null;
    isPostFinalRetainedHistory: boolean;
    displayName: string;
    opportunityId: string;
    milestoneId: string;
    milestoneType: TicketOpportunityMilestone["milestoneType"];
    isFirstRowForOpportunity: boolean;
    isEffectivelyCanceled: boolean;
    sourceUrl: string | null;
  }> = {},
) {
  const {
    myState = null,
    isPostFinalRetainedHistory = false,
    displayName = "一般発売",
    isFirstRowForOpportunity = true,
    isEffectivelyCanceled = false,
    sourceUrl = "https://example.com/tickets",
    milestoneType = "sale_start",
  } = overrides;
  return {
    opportunityId: ticketOpportunityIdSchema.parse(
      overrides.opportunityId ?? "44444444-4444-4444-8444-444444444444",
    ),
    displayName,
    eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    milestone: ticketOpportunityMilestoneSchema.parse({
      id: ticketOpportunityMilestoneIdSchema.parse(
        overrides.milestoneId ?? "55555555-5555-4555-8555-555555555555",
      ),
      opportunityId: ticketOpportunityIdSchema.parse(
        overrides.opportunityId ?? "44444444-4444-4444-8444-444444444444",
      ),
      milestoneType,
      temporalPrecision: "datetime",
      at: instantSchema.parse("2026-03-10T10:00:00.000Z"),
      createdAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    }),
    sortInstant: instantSchema.parse("2026-03-10T10:00:00.000Z"),
    myState,
    isFirstRowForOpportunity,
    isPostFinalRetainedHistory,
    isEffectivelyCanceled,
    eventTitle: "テスト公演",
    eventVenue: "テスト劇場",
    targetScope: "event_wide",
    targetOccurrences: [],
    sourceUrl,
  } satisfies import("../_lib/tickets-loader").TicketsTimelineRow;
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
  it("gives each current Opportunity row a stable Home deep-link target", () => {
    render(<TicketsView today={TODAY} state={POPULATED} />);

    expect(
      document.getElementById(
        "ticket-opportunity-44444444-4444-4444-8444-444444444444",
      ),
    ).toBeInTheDocument();
  });

  it("exposes URL-backed filters and marks the current view", () => {
    render(<TicketsView today={TODAY} state={POPULATED} />);

    expect(screen.getByRole("link", { name: "今後" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "過去（7日）" })).toHaveAttribute(
      "href",
      "/tickets?view=past",
    );
  });

  it.each([
    { view: "planned" as const, filterLabel: "自分の申込予定" },
    { view: "applied" as const, filterLabel: "自分の申込済み" },
  ])(
    "shows shared upcoming rows when $view state is unknown, without applying the personal filter",
    ({ view, filterLabel }) => {
      render(
        <TicketsView
          today={TODAY}
          view={view}
          state={{
            block: POPULATED.block,
            optional: { ok: false, variant: "error" },
          }}
        />,
      );

      expect(screen.getByRole("link", { name: "今後" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByText("自分の申込予定").closest("span"),
      ).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByText("テスト公演")).toBeInTheDocument();
      expect(screen.getByText("不明")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        `「${filterLabel}」では絞り込めないため、フィルターを「今後」に切り替えました。申込状態は不明です。`,
      );
      expect(screen.queryByText("自分：申込済み")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /申込/u }),
      ).not.toBeInTheDocument();
    },
  );

  it("does not claim a personal-filtered list is empty when its state is unknown", () => {
    render(
      <TicketsView
        today={TODAY}
        view="planned"
        state={{
          block: { variant: "empty" },
          optional: { ok: false, variant: "error" },
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "今後" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByText("自分の申込予定はありません"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("自分の申込予定");
  });
  it("renders the empty state copy", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{ block: { variant: "empty" }, optional: { ok: true } }}
      />,
    );
    expect(
      screen.getByText("今後の抽選・販売スケジュールはありません"),
    ).toBeInTheDocument();
  });

  it("uses neutral date wording for an empty past view", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
        state={{ block: { variant: "empty" }, optional: { ok: true } }}
      />,
    );

    expect(
      screen.getByText("直近7日以内に表示できる過去の日程はありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/受付はありません/u)).not.toBeInTheDocument();
  });

  it("renders the error state as an alert with a generic retry hint (never a raw message)", () => {
    render(
      <TicketsView
        today={TODAY}
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
        today={TODAY}
        state={{ block: { variant: "unavailable" }, optional: { ok: true } }}
      />,
    );
    expect(
      screen.getByText("チケット情報を確認できません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("groups populated rows by month and shows the 申し込み済み badge", () => {
    render(<TicketsView today={TODAY} state={POPULATED} />);
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
    expect(screen.getByText("自分：申込済み")).toBeInTheDocument();
    expect(screen.getByText("販売開始")).toBeInTheDocument();
  });

  it("provides official-source access for a renderable source URL", () => {
    render(<TicketsView today={TODAY} state={POPULATED} />);

    expect(screen.getByRole("link", { name: "公式情報" })).toHaveAttribute(
      "href",
      "https://example.com/tickets",
    );
    expect(screen.getByText("公式サイト：example.com")).toBeInTheDocument();
  });

  it("wraps a maximum-length valid source hostname", () => {
    const host = `${"a".repeat(63)}.example.com`;
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [row({ sourceUrl: `https://${host}/tickets` })],
                },
              ],
            },
          },
          optional: { ok: true },
        }}
      />,
    );

    expect(screen.getByText(host, { exact: false })).toHaveClass("break-words");
  });

  it("does not render a source hostname for an unrenderable URL", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [row({ sourceUrl: "javascript:alert(1)" })],
                },
              ],
            },
          },
          optional: { ok: true },
        }}
      />,
    );

    expect(screen.queryByText(/^公式サイト：/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "公式情報" }),
    ).not.toBeInTheDocument();
  });

  it("keeps similarly named same-day opportunities distinct and shows each source host", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [
                    row({
                      displayName: "月組 第2抽選",
                      opportunityId: "66666666-6666-4666-8666-666666666666",
                      milestoneId: "77777777-7777-4777-8777-777777777777",
                      sourceUrl: "https://ticket-a.example/apply",
                    }),
                    row({
                      displayName: "月組 第2抽選",
                      opportunityId: "88888888-8888-4888-8888-888888888888",
                      milestoneId: "99999999-9999-4999-8999-999999999999",
                      sourceUrl: "https://ticket-b.example/apply",
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

    expect(screen.getAllByText("テスト劇場・月組 第2抽選")).toHaveLength(2);
    expect(
      screen.getByText("公式サイト：ticket-a.example"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("公式サイト：ticket-b.example"),
    ).toBeInTheDocument();
  });

  it.each([
    ["missing", null],
    ["non-renderable", "javascript:alert(1)"],
  ] as const)(
    "does not fabricate official-source access for a %s source URL",
    (_caseName, sourceUrl) => {
      render(
        <TicketsView
          today={TODAY}
          state={{
            block: {
              variant: "populated",
              data: {
                groups: [{ monthKey: "2026-03", rows: [row({ sourceUrl })] }],
              },
            },
            optional: { ok: true },
          }}
        />,
      );

      expect(
        screen.queryByRole("link", { name: "公式情報" }),
      ).not.toBeInTheDocument();
    },
  );

  it("keeps non-contiguous same-month sections distinct without duplicate-key warnings", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      render(
        <TicketsView
          today={TODAY}
          state={{
            block: {
              variant: "populated",
              data: {
                groups: [
                  {
                    monthKey: "2026-10",
                    rows: [
                      row({
                        opportunityId: "44444444-4444-4444-8444-444444444444",
                        milestoneId: "55555555-5555-4555-8555-555555555555",
                      }),
                    ],
                  },
                  {
                    monthKey: "2026-09",
                    rows: [
                      row({
                        opportunityId: "66666666-6666-4666-8666-666666666666",
                        milestoneId: "77777777-7777-4777-8777-777777777777",
                      }),
                    ],
                  },
                  {
                    monthKey: "2026-10",
                    rows: [
                      row({
                        opportunityId: "88888888-8888-4888-8888-888888888888",
                        milestoneId: "99999999-9999-4999-8999-999999999999",
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

      expect(
        screen
          .getAllByRole("region")
          .map((section) => section.getAttribute("aria-label")),
      ).toEqual(["2026年10月", "2026年9月", "2026年10月"]);
      expect(
        consoleError.mock.calls.some((args) =>
          args.some(
            (argument) =>
              typeof argument === "string" && argument.includes("same key"),
          ),
        ),
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("labels a retained application-close row 受付終了 over the personal planning-state badge", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
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
                      milestoneType: "application_close",
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
    expect(screen.queryByText("自分：申込済み")).not.toBeInTheDocument();
  });

  it("prioritizes 中止 over retained history, applied, and 不明", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
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
                      isEffectivelyCanceled: true,
                      milestoneType: "application_close",
                    }),
                  ],
                },
              ],
            },
          },
          optional: { ok: false, variant: "error" },
        }}
      />,
    );

    expect(screen.getAllByText("中止")).toHaveLength(1);
    expect(screen.queryByText("受付終了")).not.toBeInTheDocument();
    expect(screen.queryByText("自分：申込済み")).not.toBeInTheDocument();
    expect(screen.queryByText("不明")).not.toBeInTheDocument();
    expect(
      screen.getByText("申し込み状態を取得できませんでした"),
    ).toBeInTheDocument();
  });

  it("prioritizes 中止 over 申し込む予定", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [
                    row({
                      myState: "planned",
                      isEffectivelyCanceled: true,
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

    expect(screen.getByText("中止")).toBeInTheDocument();
    expect(screen.queryByText("自分：申込予定")).not.toBeInTheDocument();
  });

  it("labels a retained sale-start row 過去 instead of 受付終了", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [row({ isPostFinalRetainedHistory: true })],
                },
              ],
            },
          },
          optional: { ok: true },
        }}
      />,
    );

    expect(screen.getByText("過去")).toBeInTheDocument();
    expect(screen.queryByText("受付終了")).not.toBeInTheDocument();
  });

  it("keeps the active planning-state badge when cancellation is false", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                {
                  monthKey: "2026-03",
                  rows: [row({ myState: "planned" })],
                },
              ],
            },
          },
          optional: { ok: true },
        }}
      />,
    );

    expect(screen.getByText("自分：申込予定")).toBeInTheDocument();
    expect(screen.queryByText("中止")).not.toBeInTheDocument();
  });

  it.each([
    { myState: "planned" as const, label: "自分：申込予定" },
    { myState: "applied" as const, label: "自分：申込済み" },
  ])(
    "keeps $myState as personal state on a result-announcement row",
    ({ myState, label }) => {
      render(
        <TicketsView
          today={TODAY}
          state={{
            block: {
              variant: "populated",
              data: {
                groups: [
                  {
                    monthKey: "2026-03",
                    rows: [
                      row({ myState, milestoneType: "result_announcement" }),
                    ],
                  },
                ],
              },
            },
            optional: { ok: true },
          }}
        />,
      );

      expect(
        screen.getByText(formatMilestoneTypeJa("result_announcement")),
      ).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

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
        today={TODAY}
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
    expect(screen.queryByText("自分：申込済み")).not.toBeInTheDocument();
    expect(
      screen.getByText("申し込み状態を取得できませんでした"),
    ).toBeInTheDocument();
  });

  it("still shows 受付終了 (not 不明) for post-final rows even when the personal-state read fails", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
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
                      milestoneType: "application_close",
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
    render(<TicketsView today={TODAY} state={POPULATED} />);
    expect(
      screen.queryByText("申し込み状態を取得できませんでした"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("申し込み状態を確認できません"),
    ).not.toBeInTheDocument();
  });

  // M8 で確定した v2 の不具合（この write UI 自体が未実装だった）の修正。
  it("renders the planning-state controls once, for the opportunity's first row, when the personal-state read succeeds", () => {
    render(<TicketsView today={TODAY} state={POPULATED} />);
    expect(
      screen.getByRole("button", { name: "申し込む予定に戻す" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "登録を解除" }),
    ).toBeInTheDocument();
  });

  it("does not render the planning-state controls on a non-first row of the same Opportunity", () => {
    render(
      <TicketsView
        today={TODAY}
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
                      isFirstRowForOpportunity: false,
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
    expect(
      screen.queryByRole("button", { name: "申し込む予定に戻す" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録を解除" }),
    ).not.toBeInTheDocument();
  });

  it("does not render the planning-state controls when the personal-state read failed (state unknown)", () => {
    render(
      <TicketsView
        today={TODAY}
        state={{
          block: {
            variant: "populated",
            data: {
              groups: [
                { monthKey: "2026-03", rows: [row({ myState: "applied" })] },
              ],
            },
          },
          optional: { ok: false, variant: "error" },
        }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "申し込む予定に戻す" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録を解除" }),
    ).not.toBeInTheDocument();
  });

  // A post-final（受付終了確定後）行は、personal-state read が成功していても
  // planning-state controls 自体を非表示にする。
  it("does not render the planning-state controls on a post-final (受付終了) row", () => {
    render(
      <TicketsView
        today={TODAY}
        view="past"
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
    expect(
      screen.queryByRole("button", { name: "申し込む予定に戻す" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "登録を解除" }),
    ).not.toBeInTheDocument();
  });
});

describe("販売機会名の表示（PR #381 review）", () => {
  it("同種 milestone・同日時の 2 行を販売機会名で区別できる", () => {
    const state: OptionalPartBlockState<TicketsTimelineState> = {
      block: {
        variant: "populated",
        data: {
          groups: [
            {
              monthKey: "2026-03",
              rows: [
                row({
                  displayName: "FC先行",
                  opportunityId: "44444444-4444-4444-8444-444444444444",
                  milestoneId: "55555555-5555-4555-8555-555555555555",
                }),
                row({
                  displayName: "一般発売",
                  opportunityId: "66666666-6666-4666-8666-666666666666",
                  milestoneId: "77777777-7777-4777-8777-777777777777",
                }),
              ],
            },
          ],
        },
      },
      optional: { ok: true },
    };

    render(<TicketsView today={TODAY} state={state} />);

    // 種別と日時だけでは 2 行が同一に見える。販売機会名がその唯一の
    // 判別材料なので、両方が実際に描画されていることを確認する。
    expect(screen.getByText(/FC先行$/)).toBeInTheDocument();
    expect(screen.getByText(/一般発売$/)).toBeInTheDocument();
  });
});
