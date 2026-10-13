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
  recoveryReviewRequired: false,
  recoveryHoldRunId: null,
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

export const RecoveryReviewRequiredNoOp: Story = {
  args: {
    state: {
      variant: "populated",
      data: [
        {
          ...pendingCandidate,
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "event.kabuki-bito.schedule",
          recoveryReviewRequired: true,
          recoveryHoldRunId: null,
          proposal: {
            ...pendingCandidate.proposal,
            sourceKey: "kabuki:sample-2026",
          },
          currentEvent: {
            id: "44444444-4444-4444-8444-444444444444",
            sourceKey: "kabuki:sample-2026",
            title: "Sample revue",
            venue: "Grand Theater",
            memo: null,
            sourceUrl: pendingCandidate.canonicalUrl,
            startsOn: "2026-10-01",
            endsOn: "2026-11-10",
            occurrences: [],
          },
          plan: {
            action: "unchanged",
            hasChanges: false,
            changes: ["Current Event has no changes"],
          },
          match: {
            deterministicStatus: "matched",
            semanticStatus: "not_used",
            jev: null,
          },
        },
      ],
    },
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
