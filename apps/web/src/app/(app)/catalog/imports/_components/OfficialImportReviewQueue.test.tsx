import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { OfficialImportReviewCandidate } from "../_lib/review-types";
import { OfficialImportReviewQueue } from "./OfficialImportReviewQueue";

const mockReviewAction = vi.fn();
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
    changes: ["新しいイベントを作成", "公演回 1件を追加"],
  },
  evidence: { sectionLabel: "2026年10月", rowLabel: "テスト公演" },
  match: {
    deterministicStatus: "ambiguous",
    semanticStatus: "matched",
    jev: {
      provider: "jev",
      model: "semantic-match-v1",
      choice: "event-123",
      confidence: 0.82,
    },
  },
  blockedReason: null,
};

describe("OfficialImportReviewQueue", () => {
  beforeEach(() => {
    mockReviewAction.mockReset();
    mockRefresh.mockReset();
  });

  it("presents source, proposal, diff, evidence, match and Jev as supporting evidence", () => {
    render(
      <OfficialImportReviewQueue
        state={{ variant: "populated", data: [candidate] }}
        reviewAction={mockReviewAction}
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
  });

  it("uses the narrow review action and reports approval", async () => {
    mockReviewAction.mockResolvedValue({ data: { reviewStatus: "approved" } });
    render(
      <OfficialImportReviewQueue
        state={{ variant: "populated", data: [candidate] }}
        reviewAction={mockReviewAction}
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
              },
              plan: { action: "update", changes: ["基本情報を更新"] },
            },
          ],
        }}
        reviewAction={mockReviewAction}
      />,
    );

    expect(screen.getByText("現在の公演名")).toBeInTheDocument();
    expect(screen.getByText("catalog:event-123")).toBeInTheDocument();
    expect(screen.getByText("現在の会場")).toBeInTheDocument();
    expect(screen.getByText("2026-09-30〜2026-10-01")).toBeInTheDocument();
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
      />,
    );

    expect(
      screen.queryByRole("button", { name: "承認" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "手動登録イベントとの同一性を確定できないため、承認できません。",
      ),
    ).toBeInTheDocument();
  });

  it.each(["empty", "unavailable", "error"] as const)(
    "renders the %s state without a fake queue",
    (variant) => {
      render(
        <OfficialImportReviewQueue
          state={{ variant }}
          reviewAction={mockReviewAction}
        />,
      );
      expect(
        screen.queryByRole("button", { name: "承認" }),
      ).not.toBeInTheDocument();
    },
  );
});
