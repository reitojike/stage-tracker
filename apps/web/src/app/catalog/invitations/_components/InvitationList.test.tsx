import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  eventIdSchema,
  instantSchema,
  invitationIdSchema,
  occurrenceIdSchema,
  tokyoCalendarDateSchema,
  userIdSchema,
} from "@stage-tracker/domain";
import { InvitationList } from "./InvitationList";
import type { ReceivedInvitation } from "../_data/listMyReceivedInvitations";

const mockAccept = vi.fn();
const mockDecline = vi.fn();
const mockUndo = vi.fn();
const mockRefresh = vi.fn();

vi.mock("@/lib/actions/invitations", () => ({
  acceptInvitationAction: (...args: unknown[]) => mockAccept(...args),
  declineInvitationAction: (...args: unknown[]) => mockDecline(...args),
  undoDeclineInvitationAction: (...args: unknown[]) => mockUndo(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const OCCURRENCE_ID = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const INVITER_ID = userIdSchema.parse("22222222-2222-4222-8222-222222222222");
const INVITEE_ID = userIdSchema.parse("33333333-3333-4333-8333-333333333333");
const INVITATION_ID = invitationIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const EVENT_ID = eventIdSchema.parse("55555555-5555-4555-8555-555555555555");

function buildInvitation(): ReceivedInvitation {
  return {
    invitationId: INVITATION_ID,
    occurrenceId: OCCURRENCE_ID,
    inviterId: INVITER_ID,
    context: {
      event: {
        id: EVENT_ID,
        ownerId: INVITER_ID,
        title: "My Event",
        venue: null,
        sourceUrl: null,
        memo: null,
        startsOn: tokyoCalendarDateSchema.parse("2026-05-01"),
        endsOn: tokyoCalendarDateSchema.parse("2026-05-31"),
        canceledAt: null,
        createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
        updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
      },
      occurrence: {
        id: OCCURRENCE_ID,
        eventId: EVENT_ID,
        doorsAt: null,
        startsAt: instantSchema.parse("2026-05-10T09:00:00Z"),
        endsAt: null,
        canceledAt: null,
        createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
        updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
      },
    },
  };
}

/**
 * 受け入れ条件「decline → undo で pending invitation が復元されること」の
 * 検証。P3 決定（`docs/v2/decisions.md`）どおり decline は即座に確定する
 * ため、この test は server action をモックして client 側の list-state
 * 契約（declineで即座にカードが「declined」表示へ移行し、undo成功で
 * 再び pending 表示へ戻る）だけを検証する（DB を使わない）。
 */
describe("InvitationList", () => {
  beforeEach(() => {
    mockAccept.mockReset();
    mockDecline.mockReset();
    mockUndo.mockReset();
  });

  it("restores the pending invitation in the list after decline -> undo", async () => {
    const user = userEvent.setup();
    mockDecline.mockResolvedValue({
      data: {
        snapshot: {
          occurrenceId: OCCURRENCE_ID,
          inviterId: INVITER_ID,
          inviteeId: INVITEE_ID,
        },
      },
    });
    mockUndo.mockResolvedValue({ data: { ok: true } });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);

    expect(screen.getByText("未回答 1件")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "参加しない" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "参加しない" }));

    expect(mockDecline).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
    });
    expect(
      await screen.findByText("参加しないにしました。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "参加する" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("未回答 0件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取り消す" }));

    expect(mockUndo).toHaveBeenCalledWith({
      occurrenceId: OCCURRENCE_ID,
      inviterId: INVITER_ID,
      inviteeId: INVITEE_ID,
    });
    expect(
      await screen.findByRole("button", { name: "参加する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "参加しない" }),
    ).toBeInTheDocument();
    expect(screen.getByText("未回答 1件")).toBeInTheDocument();
  });

  it("keeps the card removed and shows an error when undo fails", async () => {
    const user = userEvent.setup();
    mockDecline.mockResolvedValue({
      data: {
        snapshot: {
          occurrenceId: OCCURRENCE_ID,
          inviterId: INVITER_ID,
          inviteeId: INVITEE_ID,
        },
      },
    });
    mockUndo.mockResolvedValue({
      serverError: { kind: "failure", message: "招待を復元できませんでした。" },
    });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);
    await user.click(screen.getByRole("button", { name: "参加しない" }));
    await user.click(await screen.findByRole("button", { name: "取り消す" }));

    expect(
      await screen.findByText(
        "招待を復元できませんでした。招待者に再度の招待を依頼してください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "参加する" }),
    ).not.toBeInTheDocument();
  });

  it("removes every card for the same occurrence when one is accepted", async () => {
    const user = userEvent.setup();
    mockAccept.mockResolvedValue({ data: { ok: true } });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);
    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(mockAccept).toHaveBeenCalledWith({ occurrenceId: OCCURRENCE_ID });
    expect(await screen.findByText("招待はありません。")).toBeInTheDocument();
  });
});
