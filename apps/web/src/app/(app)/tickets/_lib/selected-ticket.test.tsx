import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  err,
  ok,
  ticketOpportunityIdSchema,
  ticketOpportunityWithTargetsSchema,
  ticketOpportunityMilestoneSchema,
  userTicketOpportunityStateSchema,
  userIdSchema,
  type UserTicketOpportunityStatus,
} from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import type { TicketOpportunityDetail } from "@/lib/data";
import { resolveScreenNow } from "@/app/_lib/now";
import {
  loadSelectedTicket,
  parseTicketSelection,
  type SelectedTicket,
} from "./selected-ticket";
import { SelectedTicketView } from "../_components/SelectedTicketView";

const reads = vi.hoisted(() => ({ public: vi.fn(), own: vi.fn() }));
vi.mock("@/lib/data", async (original) => ({
  ...(await original<typeof import("@/lib/data")>()),
  listTicketOpportunities: reads.public,
  listMyTicketOpportunityStates: reads.own,
}));
vi.mock("@/lib/actions/ticketOpportunityState.actions", () => ({
  updateTicketOpportunityStateAction: vi.fn(),
}));

const A = ticketOpportunityIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const B = ticketOpportunityIdSchema.parse(
  "44444444-4444-4444-8444-444444444445",
);
const USER = userIdSchema.parse("11111111-1111-4111-8111-111111111111");
const now = resolveScreenNow(Date.parse("2026-03-01T00:00:00Z"));
const client = createClient<Database>("https://example.supabase.test", "anon", {
  auth: { persistSession: false },
});
const stamp = "2026-01-01T00:00:00Z";

function detail(id = A): TicketOpportunityDetail {
  return {
    opportunityWithTargets: ticketOpportunityWithTargetsSchema.parse({
      opportunity: {
        id,
        eventId: "22222222-2222-4222-8222-222222222222",
        targetScope: "event_wide",
        displayName: "同名の受付",
        sourceKey: id,
        sourceUrl: "https://official.example.test/event",
        memo: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
      targetOccurrenceIds: [],
    }),
    milestones: [
      ticketOpportunityMilestoneSchema.parse({
        id: "55555555-5555-4555-8555-555555555555",
        opportunityId: id,
        milestoneType: "application_close",
        temporalPrecision: "date",
        dateValue: "2026-03-01",
        createdAt: stamp,
        updatedAt: stamp,
      }),
    ],
    cancellationScope: {
      eventCanceled: false,
      targetScope: "event_wide",
      targetOccurrenceIdCount: 0,
      resolvedTargetOccurrences: [],
    },
    isEffectivelyCanceled: false,
    eventTitle: "テスト公演",
    eventVenue: null,
    targetOccurrences: [],
  };
}

function own(
  opportunityId = A,
  status: UserTicketOpportunityStatus = "planned",
) {
  return userTicketOpportunityStateSchema.parse({
    id: "88888888-8888-4888-8888-888888888888",
    userId: USER,
    opportunityId,
    status,
    createdAt: stamp,
    updatedAt: stamp,
  });
}
const failure = err({ kind: "failure" as const, message: "test read failure" });

beforeEach(() => {
  reads.public.mockReset().mockResolvedValue(ok([detail(), detail(B)]));
  reads.own.mockReset().mockResolvedValue(ok([own(), own(B, "applied")]));
});

describe("ticket selection", () => {
  it("accepts only one public UUID", () => {
    expect(parseTicketSelection(undefined)).toEqual({ kind: "list" });
    expect(parseTicketSelection(A)).toEqual({ kind: "selected", id: A });
    for (const invalid of ["", "bad", `${A}#x`, [A], [A, B]])
      expect(parseTicketSelection(invalid)).toEqual({ kind: "invalid" });
  });
  it("joins same-name/same-date records only by exact public ID and current user", async () => {
    const result = await loadSelectedTicket(client, USER, B, now);
    expect(reads.own).toHaveBeenCalledWith(client, USER);
    expect(result.block.variant).toBe("populated");
    if (result.block.variant === "populated")
      expect(result.block.data).toMatchObject({
        myState: "applied",
        detail: { opportunityWithTargets: { opportunity: { id: B } } },
      });
  });
  it("distinguishes missing from required read failure", async () => {
    reads.public.mockResolvedValueOnce(ok([]));
    expect((await loadSelectedTicket(client, USER, A, now)).block.variant).toBe(
      "empty",
    );
    reads.public.mockResolvedValueOnce(failure);
    expect((await loadSelectedTicket(client, USER, A, now)).block.variant).toBe(
      "error",
    );
  });
  it("retains a public record beyond timeline retention and preserves its own state", async () => {
    const base = detail();
    const old = {
      ...base,
      milestones: [
        ticketOpportunityMilestoneSchema.parse({
          ...base.milestones[0],
          dateValue: "2026-01-01",
        }),
      ],
    };
    reads.public.mockResolvedValueOnce(ok([old]));
    const result = await loadSelectedTicket(client, USER, A, now);
    expect(result.block.variant).toBe("populated");
    if (result.block.variant === "populated")
      expect(result.block.data).toMatchObject({
        myState: "planned",
        canChangeState: false,
        pastMilestoneIds: [old.milestones[0]?.id],
      });
  });
  it.each(["cancelled", "zero milestones"])(
    "does not offer new actions for %s",
    async (caseName) => {
      const entry = {
        ...detail(),
        ...(caseName === "cancelled"
          ? { isEffectivelyCanceled: true }
          : { milestones: [] }),
      };
      reads.public.mockResolvedValueOnce(ok([entry]));
      const result = await loadSelectedTicket(client, USER, A, now);
      if (result.block.variant !== "populated")
        throw new Error("expected selected record");
      expect(result.block.data?.canChangeState).toBe(false);
    },
  );
  it("keeps date-only today current but exact past instants ended", async () => {
    const first = await loadSelectedTicket(client, USER, A, now);
    if (first.block.variant !== "populated")
      throw new Error("expected selected record");
    expect(first.block.data?.canChangeState).toBe(true);
    const base = detail();
    const entry = {
      ...base,
      milestones: [
        ticketOpportunityMilestoneSchema.parse({
          ...base.milestones[0],
          temporalPrecision: "datetime",
          dateValue: undefined,
          at: "2026-02-28T23:59:59Z",
        }),
      ],
    };
    reads.public.mockResolvedValueOnce(ok([entry]));
    const second = await loadSelectedTicket(client, USER, A, now);
    if (second.block.variant !== "populated")
      throw new Error("expected selected record");
    expect(second.block.data?.canChangeState).toBe(false);
  });
  it("keeps own read failure explicit and blocks controls", async () => {
    reads.own.mockResolvedValueOnce(failure);
    const result = await loadSelectedTicket(client, USER, A, now);
    expect(result.optional).toEqual({ ok: false, variant: "error" });
    render(<SelectedTicketView state={result} />);
    expect(screen.getByText("自分の申込状態：不明")).toBeInTheDocument();
    expect(screen.queryByText("自分：未登録")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "公式情報を開く" }),
    ).toHaveAttribute("href", "https://official.example.test/event");
  });
});

function selected(
  entry = detail(),
  myState: UserTicketOpportunityStatus | null = "planned",
): SelectedTicket {
  return { detail: entry, myState, canChangeState: true, pastMilestoneIds: [] };
}
function state(entry: SelectedTicket) {
  return {
    block: { variant: "populated" as const, data: entry },
    optional: { ok: true as const },
  };
}

describe("selected receipt display", () => {
  it("keeps identity, dates, a prominent honest source link and separate event/list links", () => {
    render(<SelectedTicketView state={state(selected())} />);
    expect(
      screen.getByRole("heading", { name: "同名の受付" }),
    ).toBeInTheDocument();
    expect(screen.getByText("受付締切")).toBeInTheDocument();
    expect(screen.getByText("自分：申込予定")).toBeInTheDocument();
    const external = screen.getByRole("link", { name: "公式情報を開く" });
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByText("公式サイト：official.example.test"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "公演情報" })).toHaveAttribute(
      "href",
      "/catalog/events/22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByRole("link", { name: "受付一覧" })).toHaveAttribute(
      "href",
      "/tickets",
    );
  });
  it.each([null, "javascript:alert(1)", "/relative", "ftp://example.com"])(
    "does not fabricate or render unsafe source %s",
    (sourceUrl) => {
      const entry = detail();
      const safe = {
        ...entry,
        opportunityWithTargets: {
          ...entry.opportunityWithTargets,
          opportunity: {
            ...entry.opportunityWithTargets.opportunity,
            sourceUrl,
          },
        },
      };
      render(<SelectedTicketView state={state(selected(safe))} />);
      expect(
        screen.queryByRole("link", { name: "公式情報を開く" }),
      ).not.toBeInTheDocument();
    },
  );
  it("resets controls on A→B query navigation by public identity", () => {
    const view = render(
      <SelectedTicketView state={state(selected(detail(), "planned"))} />,
    );
    expect(
      screen.getByRole("button", { name: "申し込み済みにする" }),
    ).toBeInTheDocument();
    view.rerender(
      <SelectedTicketView state={state(selected(detail(B), "applied"))} />,
    );
    expect(
      screen.getByRole("button", { name: "申し込む予定に戻す" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "申し込み済みにする" }),
    ).not.toBeInTheDocument();
  });
  it("shows historical own state without controls, with close-specific terminal wording", () => {
    const entry = selected();
    render(
      <SelectedTicketView
        state={state({
          ...entry,
          canChangeState: false,
          pastMilestoneIds: entry.detail.milestones.map((x) => x.id),
        })}
      />,
    );
    expect(screen.getByText("受付終了")).toBeInTheDocument();
    expect(screen.getByText("自分：申込予定")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("does not turn missing or load failure into an empty timeline", () => {
    const view = render(
      <SelectedTicketView
        state={{ block: { variant: "empty" }, optional: { ok: true } }}
      />,
    );
    expect(screen.getByText("受付が見つかりません")).toBeInTheDocument();
    view.rerender(
      <SelectedTicketView
        state={{ block: { variant: "error" }, optional: { ok: true } }}
      />,
    );
    expect(
      screen.getByText("チケット受付を読み込めませんでした"),
    ).toBeInTheDocument();
  });
});
