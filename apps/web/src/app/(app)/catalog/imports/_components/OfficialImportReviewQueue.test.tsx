import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OfficialImportReviewCandidate } from "../_lib/review-types";
import { OfficialImportReviewQueue } from "./OfficialImportReviewQueue";

const mockReviewAction = vi.fn();
const mockApplyAction = vi.fn();
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
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "新しい候補を取り込み、再確認してください",
    );
    expect(
      screen.queryByRole("button", { name: "反映を再試行" }),
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
    const lookupEventAction = vi.fn();
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
    fireEvent.click(screen.getByRole("button", { name: /九月博多座特別公演/ }));
    expect(screen.getByText("2026-09-03〜2026-09-14")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "このEventに紐づけて承認" }),
    );
    await waitFor(() =>
      expect(bindAction).toHaveBeenCalledWith({
        candidateId: candidate.id,
        eventId,
      }),
    );
    expect(lookupEventAction).not.toHaveBeenCalled();
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
