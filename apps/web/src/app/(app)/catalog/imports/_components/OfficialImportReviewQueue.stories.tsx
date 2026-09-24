import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { OfficialImportReviewQueue } from "./OfficialImportReviewQueue";
import type { OfficialImportReviewCandidate } from "../_lib/review-types";

const storyReviewAction = async () => ({
  data: { reviewStatus: "approved" },
});
const storyApplyAction = async () => ({ data: { workflowRunId: "demo" } });

const pendingCandidate: OfficialImportReviewCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "event",
  sourceId: "event.takarazuka-revue.schedule",
  canonicalUrl: "https://kageki.hankyu.co.jp/revue/2026/sample/index.html",
  observedAt: "2026-09-23T01:00:00.000Z",
  officialExternalId: "sample-2026",
  reviewStatus: "pending",
  applyStatus: "not_started",
  applyFailureClassification: null,
  applyLeaseExpiresAt: null,
  proposal: {
    kind: "event",
    sourceKey: "takarazuka:sample-2026",
    title: "サンプル公演",
    venue: "宝塚大劇場",
    memo: null,
    sourceUrl: "https://kageki.hankyu.co.jp/revue/2026/sample/index.html",
    startsOn: "2026-10-01",
    endsOn: "2026-11-10",
    occurrences: [
      {
        doorsAt: "2026-10-01T03:30:00.000Z",
        startsAt: "2026-10-01T04:00:00.000Z",
        endsAt: null,
      },
    ],
    genre: "musical",
    groups: [{ key: "flower", displayName: "花組" }],
  },
  currentEvent: null,
  currentTicketOpportunity: null,
  plan: {
    action: "create",
    hasChanges: true,
    changes: ["新しいイベントを作成"],
  },
  evidence: { sectionLabel: "公演情報", rowLabel: "宝塚大劇場" },
  match: {
    deterministicStatus: "unmatched",
    semanticStatus: "not_used",
    jev: null,
  },
  blockedReason: null,
};

const meta: Meta<typeof OfficialImportReviewQueue> = {
  title: "Catalog/OfficialImportReviewQueue",
  component: OfficialImportReviewQueue,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/catalog/imports" },
    },
  },
};

export default meta;
type Story = StoryObj<typeof OfficialImportReviewQueue>;

export const Pending: Story = {
  args: {
    state: { variant: "populated", data: [pendingCandidate] },
    reviewAction: storyReviewAction,
    applyAction: storyApplyAction,
  },
};

export const IdentityBlocked: Story = {
  args: {
    state: {
      variant: "populated",
      data: [
        {
          ...pendingCandidate,
          id: "22222222-2222-4222-8222-222222222222",
          reviewStatus: "blocked_for_identity_review",
          blockedReason:
            "イベント同一性を確定できないため、承認できません。公式IDの解決が必要です。",
        },
      ],
    },
    reviewAction: storyReviewAction,
    applyAction: storyApplyAction,
  },
};

export const Empty: Story = {
  args: {
    state: { variant: "empty" },
    reviewAction: storyReviewAction,
    applyAction: storyApplyAction,
  },
};
