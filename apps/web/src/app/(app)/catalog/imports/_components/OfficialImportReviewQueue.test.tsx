import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { OfficialImportReviewCandidate } from "../_lib/review-types";
import { OfficialImportReviewQueue } from "./OfficialImportReviewQueue";

const mockReviewAction = vi.fn();
const mockApplyAction = vi.fn();
const mockDismissAction = vi.fn();
const mockApplyResultAction = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const candidate: OfficialImportReviewCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "event",
  sourceId: "event.cynhn.calendar",
  canonicalUrl: "https://cynhn.com/contents/123",
  observedAt: "2026-09-23T01:02:03.000Z",
  officialExternalId: "123",
  recoveryReviewRequired: false,
  recoveryHoldRunId: null,
  reviewStatus: "pending",
  applyStatus: "not_started",
  applyFailureClassification: null,
  applyLeaseExpiresAt: null,
  proposal: {
    kind: "event",
    sourceKey: "cynhn:123",
    title: "テスト公演",
    venue: "テスト劇場",
    memo: null,
    sourceUrl: "https://cynhn.com/contents/123",
    startsOn: "2026-10-01",
    endsOn: "2026-10-02",
    occurrences: [
      {
        doorsAt: "2026-10-01T09:30:00+09:00",
        startsAt: "2026-10-01T10:00:00+09:00",
        endsAt: null,
      },
    ],
    genre: "idol",
    groups: [{ key: "cynhn", displayName: "CYNHN" }],
  },
  currentEvent: null,
  currentTicketOpportunity: null,
  plan: {
    action: "create",
    hasChanges: true,
    changes: ["新しいイベントを作成", "公演回 1件を追加"],
  },
  evidence: { sectionLabel: "2026年10月", rowLabel: "テスト公演" },
  match: {
    deterministicStatus: "unmatched",
    semanticStatus: "not_used",
    jev: null,
  },
  blockedReason: null,
};

describe("OfficialImportReviewQueue", () => {
  beforeEach(() => {
    mockReviewAction.mockReset();
    mockApplyAction.mockReset();
    mockDismissAction.mockReset();
    mockApplyResultAction.mockReset();
    mockRefresh.mockReset();
  });

  it("omits only exact-identity pending candidates with no planned changes", () => {
    const unchanged = {
      ...candidate,
      currentEvent: {
        id: "22222222-2222-4222-8222-222222222222",
        sourceKey: candidate.proposal.sourceKey,
        title: "テスト公演",
        venue: "テスト劇場",
        memo: null,
        sourceUrl: candidate.canonicalUrl,
        startsOn: "2026-10-01",
        endsOn: "2026-10-02",
        occurrences: [],
      },
      plan: {
        action: "unchanged" as const,
        hasChanges: false,
        changes: ["現在のイベントから変更なし"],
      },
      match: {
        deterministicStatus: "matched" as const,
        semanticStatus: "not_used" as const,
        jev: null,
      },
    } satisfies OfficialImportReviewCandidate;
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            unchanged,
            {
              ...unchanged,
              id: "33333333-3333-4333-8333-333333333333",
              reviewStatus: "blocked_for_identity_review",
              blockedReason: "同一性を確認してください",
            },
            {
              ...unchanged,
              id: "44444444-4444-4444-8444-444444444444",
              plan: {
                action: "unchanged",
                hasChanges: true,
                changes: ["現在のイベントから変更なし", "グループを更新"],
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.queryByText(/取得時点で変更なし/)).not.toBeInTheDocument();
  });

  it.each([null, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] as const)(
    "keeps a marked exact-identity pending no-op visible with hold id %s",
    (recoveryHoldRunId) => {
      const sourceKey = "kabuki:work:123";
      const markedNoop = {
        ...candidate,
        sourceId: "event.kabuki-bito.schedule",
        recoveryReviewRequired: true,
        recoveryHoldRunId,
        proposal: { ...candidate.proposal, sourceKey },
        currentEvent: {
          id: "22222222-2222-4222-8222-222222222222",
          sourceKey,
          title: "Test show",
          venue: "Test venue",
          memo: null,
          sourceUrl: candidate.canonicalUrl,
          startsOn: "2026-10-01",
          endsOn: "2026-10-02",
          occurrences: [],
        },
        plan: {
          action: "unchanged" as const,
          hasChanges: false,
          changes: ["Current Event has no changes"],
        },
        match: {
          deterministicStatus: "matched" as const,
          semanticStatus: "not_used" as const,
          jev: null,
        },
      } satisfies OfficialImportReviewCandidate;

      render(
        <OfficialImportReviewQueue
          state={{ variant: "populated", data: [markedNoop] }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
        />,
      );

      expect(screen.getByRole("article")).toBeInTheDocument();
      expect(screen.getByText(/unchanged/)).toBeInTheDocument();
      expect(
        screen.getByText("Current Event has no changes"),
      ).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "再確認が必要です。",
      );
      expect(screen.getAllByRole("button")).toHaveLength(2);
      expect(markedNoop.plan.hasChanges).toBe(false);
    },
  );

  it("keeps an identity-blocked marker blocked and without approval controls", () => {
    const blocked = {
      ...candidate,
      sourceId: "event.kabuki-bito.schedule",
      recoveryReviewRequired: true,
      recoveryHoldRunId: null,
      reviewStatus: "blocked_for_identity_review" as const,
      blockedReason: "identity remains blocked",
    };
    render(
      <OfficialImportReviewQueue
        state={{ variant: "populated", data: [blocked] }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "identity remains blocked",
    );
    expect(screen.getByRole("status")).toHaveTextContent("再確認が必要です。");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    {
      applyStatus: "not_started" as const,
      applyLeaseExpiresAt: null,
      applyFailureClassification: null,
    },
    {
      applyStatus: "queued" as const,
      applyLeaseExpiresAt: "2999-01-01T00:00:00.000Z",
      applyFailureClassification: null,
    },
    {
      applyStatus: "failed" as const,
      applyLeaseExpiresAt: null,
      applyFailureClassification: "unexpected" as const,
    },
  ])(
    "preserves existing apply controls for marked $applyStatus candidates",
    (state) => {
      const candidateWithStatus = {
        ...candidate,
        sourceId: "event.kabuki-bito.schedule",
        reviewStatus: "approved" as const,
        applyStatus: state.applyStatus,
        applyLeaseExpiresAt: state.applyLeaseExpiresAt,
        applyFailureClassification: state.applyFailureClassification,
      };
      render(
        <OfficialImportReviewQueue
          state={{
            variant: "populated",
            data: [
              candidateWithStatus,
              {
                ...candidateWithStatus,
                id: "66666666-6666-4666-8666-666666666666",
                recoveryReviewRequired: true,
                recoveryHoldRunId: null,
              },
            ],
          }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
          dismissAction={mockDismissAction}
        />,
      );

      const cards = screen.getAllByRole("article");
      const baseline = cards[0];
      const marked = cards[1];
      const expectedChange = candidateWithStatus.plan.changes[0];
      if (!baseline || !marked || !expectedChange) {
        throw new Error("Expected both cards and a planned change.");
      }
      expect(
        within(marked).getByText("再確認が必要です。"),
      ).toBeInTheDocument();
      expect(within(marked).getByText(/create/)).toBeInTheDocument();
      expect(within(marked).getByText(expectedChange)).toBeInTheDocument();
      expect(candidateWithStatus.plan.hasChanges).toBe(true);
      expect(marked.querySelectorAll("button")).toHaveLength(
        baseline.querySelectorAll("button").length,
      );
    },
  );

  it("shows an empty review queue when every candidate needs no change", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              currentEvent: {
                id: "22222222-2222-4222-8222-222222222222",
                sourceKey: candidate.proposal.sourceKey,
                title: "テスト公演",
                venue: "テスト劇場",
                memo: null,
                sourceUrl: candidate.canonicalUrl,
                startsOn: "2026-10-01",
                endsOn: "2026-10-02",
                occurrences: [],
              },
              plan: {
                action: "unchanged",
                hasChanges: false,
                changes: ["現在のイベントから変更なし"],
              },
              match: {
                deterministicStatus: "matched",
                semanticStatus: "not_used",
                jev: null,
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(
      screen.getByText("確認が必要な候補はありません"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("does not collapse a matching plan when the catalog source identity differs", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              currentEvent: {
                id: "22222222-2222-4222-8222-222222222222",
                sourceKey: "another:source",
                title: "テスト公演",
                venue: "テスト劇場",
                memo: null,
                sourceUrl: candidate.canonicalUrl,
                startsOn: "2026-10-01",
                endsOn: "2026-10-02",
                occurrences: [],
              },
              plan: {
                action: "unchanged",
                hasChanges: false,
                changes: ["現在のイベントから変更なし"],
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );
    expect(
      screen.queryByText(/取得時点で変更なし 1件/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "テスト公演" }),
    ).toBeInTheDocument();
  });

  it("presents source, proposal, diff, evidence, match and Jev as supporting evidence", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "blocked_for_identity_review",
              blockedReason: "Jevの照合結果だけでは承認できません。",
              match: {
                deterministicStatus: "unresolved",
                semanticStatus: "matched",
                jev: {
                  provider: "jev",
                  model: "semantic-match-v1",
                  choice: "event-123",
                  confidence: 0.82,
                },
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "公式情報を開く" }),
    ).toHaveAttribute("href", candidate.canonicalUrl);
    expect(screen.getByText("新しいイベントを作成")).toBeInTheDocument();
    expect(screen.getByText(/2026年10月 \/ テスト公演/)).toBeInTheDocument();
    expect(
      screen.getByText("Jev参考情報（判定の根拠ではありません）"),
    ).toBeInTheDocument();
    expect(screen.getByText("信頼度 82%")).toBeInTheDocument();
    expect(
      screen.getByText("現在の対象: なし（新規候補）"),
    ).toBeInTheDocument();
    expect(screen.getByText(/開演.*10:00.*開場.*9:30/)).toBeInTheDocument();
  });

  it("uses the narrow review action and reports approval", async () => {
    mockReviewAction.mockResolvedValue({ data: { reviewStatus: "approved" } });
    render(
      <OfficialImportReviewQueue
        state={{ variant: "populated", data: [candidate] }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "承認" }));
    await waitFor(() =>
      expect(mockReviewAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        decision: "approved",
      }),
    );
    expect(await screen.findByText("承認しました。")).toBeInTheDocument();
  });

  it("shows bounded current target data for an update candidate", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              currentEvent: {
                id: "22222222-2222-4222-8222-222222222222",
                sourceKey: "catalog:event-123",
                title: "現在の公演名",
                venue: "現在の会場",
                memo: null,
                sourceUrl: null,
                startsOn: "2026-09-30",
                endsOn: "2026-10-01",
                occurrences: [
                  {
                    id: "33333333-3333-4333-8333-333333333333",
                    doorsAt: "2026-09-30T08:30:00+09:00",
                    startsAt: "2026-09-30T09:00:00+09:00",
                    endsAt: "2026-09-30T11:30:00+09:00",
                  },
                ],
              },
              plan: {
                action: "update",
                hasChanges: true,
                changes: ["基本情報を更新"],
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(screen.getByText("現在の公演名")).toBeInTheDocument();
    expect(screen.getByText("catalog:event-123")).toBeInTheDocument();
    expect(screen.getByText("現在の会場")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30〜2026-10-01")).toBeInTheDocument();
    expect(screen.getByText(/開演.*9:00.*終演.*11:30/)).toBeInTheDocument();
  });

  it("shows proposed and current selected occurrence locators for a ticket update", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              kind: "ticket_opportunity",
              proposal: {
                kind: "ticket_opportunity",
                eventSourceKey: "cynhn:event-123",
                sourceKey: "cynhn:ticket-123",
                displayName: "先行抽選",
                sourceUrl: "https://example.test/proposed-ticket",
                memo: "提案メモ",
                targetScope: "selected_occurrences",
                targetOccurrences: ["2026-10-01T10:00:00+09:00"],
                milestones: [
                  {
                    type: "application_close",
                    precision: "datetime",
                    at: "2026-09-20T23:00:00+09:00",
                  },
                ],
              },
              currentEvent: {
                id: "44444444-4444-4444-8444-444444444444",
                sourceKey: "cynhn:event-123",
                title: "提案先公演",
                venue: "提案先会場",
                memo: null,
                sourceUrl: null,
                startsOn: "2026-10-01",
                endsOn: "2026-10-02",
                occurrences: [],
              },
              currentTicketOpportunity: {
                id: "22222222-2222-4222-8222-222222222222",
                eventId: "33333333-3333-4333-8333-333333333333",
                currentEvent: {
                  id: "33333333-3333-4333-8333-333333333333",
                  sourceKey: "cynhn:old-event",
                  title: "現在の対象公演",
                },
                sourceKey: "cynhn:ticket-123",
                displayName: "現在の先行抽選",
                sourceUrl: "https://example.test/current-ticket",
                memo: "現在メモ",
                targetScope: "selected_occurrences",
                targetOccurrences: ["2026-10-02T11:00:00+09:00"],
                milestones: [
                  {
                    type: "application_close",
                    precision: "date",
                    date: "2026-09-19",
                  },
                ],
              },
              plan: {
                action: "update",
                hasChanges: true,
                changes: ["対象公演回を更新（1件）"],
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(screen.getByText(/2026-10-01T10:00:00\+09:00/)).toBeInTheDocument();
    expect(screen.getByText(/2026-10-02T11:00:00\+09:00/)).toBeInTheDocument();
    expect(
      screen.getByText(/application_close: 2026-09-19/),
    ).toBeInTheDocument();
    expect(screen.getByText("提案先公演")).toBeInTheDocument();
    expect(screen.getByText(/現在の対象公演/)).toHaveTextContent(
      "cynhn:old-event",
    );
    expect(
      screen.getByText("https://example.test/proposed-ticket"),
    ).toBeInTheDocument();
    expect(screen.getByText("提案メモ")).toBeInTheDocument();
    expect(
      screen.getByText("https://example.test/current-ticket"),
    ).toBeInTheDocument();
    expect(screen.getByText("現在メモ")).toBeInTheDocument();
  });

  it("starts the approved candidate apply workflow with candidate ID only", async () => {
    mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-1" } });
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "approved",
              match: {
                ...candidate.match,
                deterministicStatus: "matched",
                semanticStatus: "not_used",
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "カタログへ反映" }));
    await waitFor(() =>
      expect(mockApplyAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
      }),
    );
    expect(
      await screen.findByText("反映処理を開始しました。"),
    ).toBeInTheDocument();
    expect(mockReviewAction).not.toHaveBeenCalled();
  });

  describe("Kabuki apply result check", () => {
    const kabukiCandidate: OfficialImportReviewCandidate = {
      ...candidate,
      sourceId: "event.kabuki-bito.schedule",
      reviewStatus: "approved",
    };

    function renderQueue(item: OfficialImportReviewCandidate) {
      render(
        <OfficialImportReviewQueue
          state={{ variant: "populated", data: [item] }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
          applyResultAction={mockApplyResultAction}
        />,
      );
    }

    async function startApply() {
      fireEvent.click(screen.getByRole("button", { name: "カタログへ反映" }));
      expect(
        await screen.findByText("反映処理を開始しました。"),
      ).toBeInTheDocument();
    }

    it("reports start separately and checks the run only on manual request", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-k1" } });
      mockApplyResultAction
        .mockResolvedValueOnce({ data: { outcome: "pending" } })
        .mockResolvedValueOnce({ data: { outcome: "applied" } });
      renderQueue(kabukiCandidate);

      await startApply();
      expect(mockApplyResultAction).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/カタログへの反映を確認しました/),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));
      expect(
        await screen.findByText(/反映処理はまだ完了していません/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/カタログへの反映を確認しました/),
      ).not.toBeInTheDocument();

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "反映結果を確認" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));
      expect(
        await screen.findByText(/カタログへの反映を確認しました/),
      ).toBeInTheDocument();
      expect(mockApplyResultAction).toHaveBeenCalledTimes(2);
      expect(mockApplyResultAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        workflowRunId: "run-k1",
      });
      expect(mockApplyAction).toHaveBeenCalledOnce();
    });

    it("shows a freshness refusal without starting another apply", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-k2" } });
      mockApplyResultAction.mockResolvedValue({
        data: { outcome: "freshness_refused" },
      });
      renderQueue(kabukiCandidate);

      await startApply();
      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));

      const refusal = await screen.findByText(
        "最新の公式情報として扱えないため、この候補は反映しませんでした。新しい候補を取り込み、再確認してください。",
      );
      expect(refusal).toHaveAttribute("role", "alert");
      // The marker alone does not prove an observed official update.
      expect(refusal).not.toHaveTextContent("更新を確認");
      expect(
        screen.queryByText(/カタログへの反映を確認しました/),
      ).not.toBeInTheDocument();
      expect(mockApplyAction).toHaveBeenCalledOnce();
    });

    it("treats a missing or unknown result as unconfirmed, not as a failure", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-k3" } });
      mockApplyResultAction
        .mockResolvedValueOnce({ data: undefined })
        .mockResolvedValueOnce({ data: { outcome: "surprise" } });
      renderQueue(kabukiCandidate);

      await startApply();
      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));
      expect(
        await screen.findByText(/反映結果を確認できませんでした/),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "反映結果を確認" }),
        ).toBeEnabled(),
      );
      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));
      await waitFor(() =>
        expect(mockApplyResultAction).toHaveBeenCalledTimes(2),
      );
      expect(
        await screen.findByText(/反映結果を確認できませんでした/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/反映処理に失敗しました/),
      ).not.toBeInTheDocument();
      expect(mockApplyAction).toHaveBeenCalledOnce();
    });

    it("shows the fixed unconfirmed message when the check request rejects", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        mockApplyAction.mockResolvedValue({
          data: { workflowRunId: "run-k4" },
        });
        mockApplyResultAction.mockRejectedValue(
          new Error("raw network detail"),
        );
        renderQueue(kabukiCandidate);

        await startApply();
        fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));

        expect(
          await screen.findByText(/反映結果を確認できませんでした/),
        ).toHaveAttribute("role", "alert");
        expect(
          screen.queryByText(/raw network detail/),
        ).not.toBeInTheDocument();
        expect(warn).toHaveBeenCalledWith(
          "[official import apply result] check request failed",
        );
        expect(JSON.stringify(warn.mock.calls)).not.toContain(
          "raw network detail",
        );
        await waitFor(() =>
          expect(
            screen.getByRole("button", { name: "反映結果を確認" }),
          ).toBeEnabled(),
        );
        expect(mockApplyResultAction).toHaveBeenCalledOnce();
        expect(mockApplyAction).toHaveBeenCalledOnce();
      } finally {
        warn.mockRestore();
      }
    });

    it("does not copy server error text into the result message", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-k5" } });
      mockApplyResultAction.mockResolvedValue({
        serverError: { message: "raw server detail" },
      });
      renderQueue(kabukiCandidate);

      await startApply();
      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));

      expect(
        await screen.findByText(/反映結果を確認できませんでした/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/raw server detail/)).not.toBeInTheDocument();
      expect(mockApplyResultAction).toHaveBeenCalledOnce();
      expect(mockApplyAction).toHaveBeenCalledOnce();
    });

    it("keeps the started run checkable after the applied row leaves the queue", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-k6" } });
      mockApplyResultAction.mockResolvedValue({ data: { outcome: "applied" } });
      const { rerender } = render(
        <OfficialImportReviewQueue
          state={{ variant: "populated", data: [kabukiCandidate] }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
          applyResultAction={mockApplyResultAction}
        />,
      );

      await startApply();
      // The refreshed loader no longer returns the quickly applied candidate.
      rerender(
        <OfficialImportReviewQueue
          state={{ variant: "empty" }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
          applyResultAction={mockApplyResultAction}
        />,
      );
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
      expect(
        screen.getAllByRole("button", { name: "反映結果を確認" }),
      ).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: "反映結果を確認" }));

      expect(
        await screen.findByText(/カタログへの反映を確認しました/),
      ).toBeInTheDocument();
      expect(mockApplyResultAction).toHaveBeenCalledOnce();
      expect(mockApplyResultAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        workflowRunId: "run-k6",
      });
      expect(mockApplyAction).toHaveBeenCalledOnce();
    });

    it("keeps separate Kabuki starts independently checkable", async () => {
      const second: OfficialImportReviewCandidate = {
        ...kabukiCandidate,
        id: "55555555-5555-4555-8555-555555555555",
      };
      mockApplyAction
        .mockResolvedValueOnce({ data: { workflowRunId: "run-a" } })
        .mockResolvedValueOnce({ data: { workflowRunId: "run-b" } });
      mockApplyResultAction.mockResolvedValue({ data: { outcome: "pending" } });
      render(
        <OfficialImportReviewQueue
          state={{ variant: "populated", data: [kabukiCandidate, second] }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
          applyResultAction={mockApplyResultAction}
        />,
      );

      const [firstStart, secondStart] = screen.getAllByRole("button", {
        name: "カタログへ反映",
      });
      if (firstStart === undefined || secondStart === undefined)
        throw new Error("expected two start buttons");
      fireEvent.click(firstStart);
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: "反映結果を確認" }),
        ).toHaveLength(1),
      );
      fireEvent.click(secondStart);
      await waitFor(() =>
        expect(
          screen.getAllByRole("button", { name: "反映結果を確認" }),
        ).toHaveLength(2),
      );

      const [firstCheck, secondCheck] = screen.getAllByRole("button", {
        name: "反映結果を確認",
      });
      if (firstCheck === undefined || secondCheck === undefined)
        throw new Error("expected two check buttons");
      fireEvent.click(firstCheck);
      await waitFor(() =>
        expect(mockApplyResultAction).toHaveBeenCalledWith({
          candidateId: candidate.id,
          workflowRunId: "run-a",
        }),
      );
      fireEvent.click(secondCheck);
      await waitFor(() =>
        expect(mockApplyResultAction).toHaveBeenCalledWith({
          candidateId: second.id,
          workflowRunId: "run-b",
        }),
      );
      expect(mockApplyAction).toHaveBeenCalledTimes(2);
    });

    it("does not offer a result check before a Kabuki apply starts", () => {
      renderQueue(kabukiCandidate);
      expect(
        screen.queryByRole("button", { name: "反映結果を確認" }),
      ).not.toBeInTheDocument();
    });

    it("keeps other sources on the existing start-only flow", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-o1" } });
      renderQueue({ ...candidate, reviewStatus: "approved" });

      await startApply();
      expect(
        screen.queryByRole("button", { name: "反映結果を確認" }),
      ).not.toBeInTheDocument();
      expect(mockApplyResultAction).not.toHaveBeenCalled();
    });

    it("keeps a Kabuki ticket candidate on the existing start-only flow", async () => {
      mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-o2" } });
      renderQueue({ ...kabukiCandidate, kind: "ticket_opportunity" });

      await startApply();
      expect(
        screen.queryByRole("button", { name: "反映結果を確認" }),
      ).not.toBeInTheDocument();
    });
  });

  it("requires a fresh candidate after material review-to-apply drift", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "approved",
              applyStatus: "failed",
              applyFailureClassification: "source_changed",
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
        dismissAction={mockDismissAction}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "新しい候補を取り込み、再確認してください",
    );
    expect(
      screen.queryByRole("button", { name: "反映を再試行" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "対応不要として閉じる" }),
    ).toBeInTheDocument();
  });

  it("closes a failed candidate without applying or changing its review decision", async () => {
    mockDismissAction.mockResolvedValue({ data: { dismissed: true } });
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "approved",
              applyStatus: "failed",
              applyFailureClassification: "source_changed",
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
        dismissAction={mockDismissAction}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "対応不要として閉じる" }),
    );
    await waitFor(() =>
      expect(mockDismissAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(mockApplyAction).not.toHaveBeenCalled();
    expect(mockReviewAction).not.toHaveBeenCalled();
  });

  it("does not offer dismissal before an apply has failed", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [{ ...candidate, reviewStatus: "approved" }],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
        dismissAction={mockDismissAction}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "対応不要として閉じる" }),
    ).not.toBeInTheDocument();
  });

  it("allows recovery when a queued apply lease has expired", async () => {
    mockApplyAction.mockResolvedValue({ data: { workflowRunId: "run-2" } });
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "approved",
              applyStatus: "queued",
              applyLeaseExpiresAt: "2000-01-01T00:00:00.000Z",
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "反映を再試行" }));
    await waitFor(() =>
      expect(mockApplyAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
      }),
    );
  });

  it("does not offer approval for an identity-blocked candidate", () => {
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              reviewStatus: "blocked_for_identity_review",
              blockedReason:
                "手動登録イベントとの同一性を確定できないため、承認できません。",
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "承認" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "取り込み不要として却下" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "手動登録イベントとの同一性を確定できないため、承認できません。",
      ),
    ).toBeInTheDocument();
  });

  it("lets a creator reject an identity-blocked TicketOpportunity without offering approval", async () => {
    mockReviewAction.mockResolvedValue({ data: { reviewStatus: "rejected" } });
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              kind: "ticket_opportunity",
              reviewStatus: "blocked_for_identity_review",
              blockedReason: "対象Eventを確定できないため承認できません。",
              proposal: {
                kind: "ticket_opportunity",
                eventSourceKey: "unresolved:shochiku:example",
                sourceKey: "shochiku:example:general",
                displayName: "一般販売",
                sourceUrl: "https://example.test/ticket",
                memo: null,
                targetScope: "event_wide",
                targetOccurrences: [],
                milestones: [],
              },
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "承認" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "取り込み不要として却下" }),
    );
    await waitFor(() =>
      expect(mockReviewAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        decision: "rejected",
      }),
    );
    expect(await screen.findByText("却下しました。")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("previews a suggested Event before manually binding a blocked ticket", async () => {
    const eventId = "22222222-2222-4222-8222-222222222222";
    const bindAction = vi.fn(async () => ({
      data: { reviewStatus: "approved" },
    }));
    const lookupEventAction = vi.fn(async () => ({
      data: {
        id: eventId,
        title: "九月博多座特別公演",
        venue: "博多座",
        startsOn: "2026-09-03",
        endsOn: "2026-09-14",
      },
    }));
    render(
      <OfficialImportReviewQueue
        state={{
          variant: "populated",
          data: [
            {
              ...candidate,
              kind: "ticket_opportunity",
              sourceId: "ticket.shochiku.schedule",
              reviewStatus: "blocked_for_identity_review",
              blockedReason: "対象Eventを自動で確定できません。",
              proposal: {
                kind: "ticket_opportunity",
                eventSourceKey: "unresolved:shochiku:example",
                sourceKey: "shochiku:example:general",
                displayName: "一般販売",
                sourceUrl: "https://example.test/ticket",
                memo: null,
                targetScope: "event_wide",
                targetOccurrences: [],
                milestones: [],
              },
              suggestedEvents: [
                {
                  id: eventId,
                  title: "九月博多座特別公演",
                  venue: "博多座",
                  startsOn: "2026-09-03",
                  endsOn: "2026-09-14",
                },
              ],
            },
          ],
        }}
        reviewAction={mockReviewAction}
        applyAction={mockApplyAction}
        bindAction={bindAction}
        lookupEventAction={lookupEventAction}
      />,
    );
    expect(screen.getByText("もしかしてこのEvent？")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Event URL または ID"), {
      target: {
        value: `${window.location.origin}/catalog/events/${eventId}`,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Eventを確認" }));
    await waitFor(() =>
      expect(lookupEventAction).toHaveBeenCalledWith({ eventId }),
    );
    expect(
      await screen.findByRole("link", { name: "Event詳細を開く" }),
    ).toBeInTheDocument();
    const suggestion = screen.getByRole("button", {
      name: /九月博多座特別公演/,
    });
    await waitFor(() => expect(suggestion).toBeEnabled());
    fireEvent.click(suggestion);
    expect(screen.getByText("2026-09-03〜2026-09-14")).toBeInTheDocument();
    const bindButton = screen.getByRole("button", {
      name: "このEventに紐づけて承認",
    });
    await waitFor(() => expect(bindButton).toBeEnabled());
    fireEvent.click(bindButton);
    await waitFor(() =>
      expect(bindAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        eventId,
      }),
    );
    expect(mockRefresh).toHaveBeenCalled();
  });

  it.each(["empty", "unavailable", "error"] as const)(
    "renders the %s state without a fake queue",
    (variant) => {
      render(
        <OfficialImportReviewQueue
          state={{ variant }}
          reviewAction={mockReviewAction}
          applyAction={mockApplyAction}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "承認" }),
      ).not.toBeInTheDocument();
    },
  );
});
