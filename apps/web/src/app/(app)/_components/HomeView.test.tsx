import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  eventSchema,
  instantSchema,
  occurrenceIdSchema,
  occurrenceSchema,
  participationIdSchema,
  participationSchema,
  ticketOpportunityIdSchema,
  ticketOpportunityMilestoneIdSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import type {
  MergedListBlockState,
  OptionalPartBlockState,
} from "@/app/_lib/read-state";
import type {
  HomeTicketDeadlineRow,
  HomeUpcomingItem,
} from "../_lib/home-loader";
import { HomeView } from "./HomeView";

const EMPTY_TICKET: OptionalPartBlockState<readonly HomeTicketDeadlineRow[]> = {
  block: { variant: "empty" },
  optional: { ok: true },
};
const EMPTY_SCHEDULE: MergedListBlockState<readonly HomeUpcomingItem[]> = {
  variant: "empty",
};

const POPULATED_TICKET_ROWS: readonly HomeTicketDeadlineRow[] = [
  {
    row: {
      opportunityId: ticketOpportunityIdSchema.parse(
        "44444444-4444-4444-8444-444444444444",
      ),
      eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
      displayName: "一般発売",
      milestone: {
        id: ticketOpportunityMilestoneIdSchema.parse(
          "55555555-5555-4555-8555-555555555555",
        ),
        opportunityId: ticketOpportunityIdSchema.parse(
          "44444444-4444-4444-8444-444444444444",
        ),
        milestoneType: "sale_start",
        temporalPrecision: "datetime",
        at: instantSchema.parse("2026-03-10T10:00:00Z"),
        createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
        updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
      },
      sortInstant: instantSchema.parse("2026-03-10T10:00:00Z"),
      myState: "planned",
      isFirstRowForOpportunity: true,
      isPostFinalRetainedHistory: false,
    },
  },
];

const POPULATED_TICKET: OptionalPartBlockState<
  readonly HomeTicketDeadlineRow[]
> = {
  block: { variant: "populated", data: POPULATED_TICKET_ROWS },
  optional: { ok: true },
};

const event = eventSchema.parse({
  id: "22222222-2222-4222-8222-222222222222",
  ownerId: "11111111-1111-4111-8111-111111111111",
  title: "テスト公演",
  venue: null,
  sourceUrl: null,
  memo: null,
  startsOn: "2026-03-10",
  endsOn: "2026-03-20",
  canceledAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const occurrence = occurrenceSchema.parse({
  id: occurrenceIdSchema.parse("33333333-3333-4333-8333-333333333333"),
  eventId: event.id,
  doorsAt: null,
  startsAt: "2026-03-15T10:00:00Z",
  endsAt: null,
  canceledAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const participation = participationSchema.parse({
  id: participationIdSchema.parse("66666666-6666-4666-8666-666666666666"),
  occurrenceId: occurrence.id,
  userId: userIdSchema.parse("11111111-1111-4111-8111-111111111111"),
  status: "attending",
  visibility: "private",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const POPULATED_SCHEDULE: MergedListBlockState<readonly HomeUpcomingItem[]> = {
  variant: "populated",
  data: [
    {
      kind: "occurrence",
      sortInstant: occurrence.startsAt,
      participation,
      occurrence,
      event,
    },
  ],
};

describe("HomeView", () => {
  it("renders a single merged empty panel only when both blocks are empty", () => {
    render(
      <HomeView ticketState={EMPTY_TICKET} scheduleState={EMPTY_SCHEDULE} />,
    );

    expect(
      screen.getByText("期限が近い申し込みも、直近の予定もありません"),
    ).toBeInTheDocument();
    // The merged panel replaces the 2 section headings entirely.
    expect(screen.queryByText("申し込み期限")).not.toBeInTheDocument();
    expect(screen.queryByText("直近の予定")).not.toBeInTheDocument();
  });

  it("renders each block's own error/unavailable panel independently when only one fails (P4)", () => {
    render(
      <HomeView
        ticketState={{
          block: { variant: "error" },
          optional: { ok: true },
        }}
        scheduleState={POPULATED_SCHEDULE}
      />,
    );

    // The failing block shows its own error panel...
    expect(screen.getByRole("alert")).toHaveTextContent(
      "申し込み期限を読み込めませんでした",
    );
    // ...while the sibling block still renders its real, populated data.
    expect(screen.getByText("テスト公演")).toBeInTheDocument();
  });

  it("renders the unavailable variant distinctly from error", () => {
    render(
      <HomeView
        ticketState={{
          block: { variant: "unavailable" },
          optional: { ok: true },
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.getByText("申し込み期限を確認できません"),
    ).toBeInTheDocument();
    // unavailable is not an alert role (only `error` is, per StatePanel).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders populated ticket rows with their planning-state badge", () => {
    render(
      <HomeView
        ticketState={POPULATED_TICKET}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("販売開始")).toBeInTheDocument();
    expect(screen.getByText("申し込む予定")).toBeInTheDocument();
  });

  it("keeps 直近の予定 empty-but-independent when 申し込み期限 is populated", () => {
    render(
      <HomeView
        ticketState={POPULATED_TICKET}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("直近の予定はありません")).toBeInTheDocument();
  });

  /**
   * PR #381 P4 follow-up review finding 2: a failed personal-state read must
   * never be indistinguishable from every row genuinely having no personal
   * state - the badge must say "不明", not silently disappear.
   */
  it("renders the ticket-state badge as 不明, not omitted, when the personal-state read fails", () => {
    render(
      <HomeView
        ticketState={{
          block: { variant: "populated", data: POPULATED_TICKET_ROWS },
          optional: { ok: false, variant: "error" },
        }}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(screen.getByText("不明")).toBeInTheDocument();
    // The row's own (fallback-derived) `myState` badge must not appear
    // alongside/instead of 不明 - "不明" replaces it, it does not merely
    // supplement it.
    expect(screen.queryByText("申し込む予定")).not.toBeInTheDocument();
    // The failure is also surfaced as its own inline note, not just via the
    // badge - the block itself keeps rendering (title copy is never
    // replaced by a StatePanel just because the optional read failed).
    expect(
      screen.getByText("申し込み状態を取得できませんでした"),
    ).toBeInTheDocument();
  });

  it("does not show the personal-state failure note when the optional read succeeds", () => {
    render(
      <HomeView
        ticketState={POPULATED_TICKET}
        scheduleState={EMPTY_SCHEDULE}
      />,
    );

    expect(
      screen.queryByText("申し込み状態を取得できませんでした"),
    ).not.toBeInTheDocument();
  });

  /**
   * PR #381 P4 follow-up review finding 1: "1 read fails + the surviving
   * read succeeds with 0 rows" must render as `partial` (surfacing the
   * failure), never as the same `empty` panel a caller would see with no
   * failure at all.
   */
  it("renders the surviving schedule item and a failure note (not an empty panel) when participations fails and personal schedule alone is populated", () => {
    render(
      <HomeView
        ticketState={EMPTY_TICKET}
        scheduleState={{
          variant: "partial",
          data: [
            {
              kind: "occurrence",
              sortInstant: occurrence.startsAt,
              participation,
              occurrence,
              event,
            },
          ],
          a: { ok: false, variant: "error" },
          b: { ok: true },
        }}
      />,
    );

    // The surviving read's real data still renders...
    expect(screen.getByText("テスト公演")).toBeInTheDocument();
    // ...and the failed read's own failure is visible, not silently hidden.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "参加予定を読み込めませんでした",
    );
    expect(
      screen.queryByText("直近の予定はありません"),
    ).not.toBeInTheDocument();
  });

  it("renders only the failure note (no empty panel) when participations fails and personal schedule alone succeeds with 0 rows", () => {
    render(
      <HomeView
        ticketState={EMPTY_TICKET}
        scheduleState={{
          variant: "partial",
          data: [],
          a: { ok: false, variant: "unavailable" },
          b: { ok: true },
        }}
      />,
    );

    expect(screen.getByText("参加予定を確認できません")).toBeInTheDocument();
    // Never the same panel a genuine "both succeeded with 0 rows" empty
    // state would show - that would hide the real, unresolved failure.
    expect(
      screen.queryByText("直近の予定はありません"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
