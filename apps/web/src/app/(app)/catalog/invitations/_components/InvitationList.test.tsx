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
const mockRefresh = vi.fn();

vi.mock("@/lib/actions/invitations", () => ({
  acceptInvitationAction: (...args: unknown[]) => mockAccept(...args),
  declineInvitationAction: (...args: unknown[]) => mockDecline(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const OCCURRENCE_ID = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const INVITER_ID = userIdSchema.parse("22222222-2222-4222-8222-222222222222");
const INVITATION_ID = invitationIdSchema.parse(
  "44444444-4444-4444-8444-444444444444",
);
const EVENT_ID = eventIdSchema.parse("55555555-5555-4555-8555-555555555555");

function buildInvitation(options?: {
  readonly canceled?: boolean;
}): ReceivedInvitation {
  const canceledAt = options?.canceled
    ? instantSchema.parse("2026-01-02T00:00:00Z")
    : null;
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
        canceledAt,
        createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
        updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
      },
      occurrence: {
        id: OCCURRENCE_ID,
        eventId: EVENT_ID,
        doorsAt: null,
        startsAt: instantSchema.parse("2026-05-10T09:00:00Z"),
        endsAt: null,
        canceledAt,
        createdAt: instantSchema.parse("2026-01-01T00:00:00Z"),
        updatedAt: instantSchema.parse("2026-01-01T00:00:00Z"),
      },
    },
  };
}

/**
 * M6d: undo は Issue #382 へ切り出し済み（`docs/v2/decisions.md`「P3 の
 * 実装可否」節）。decline は即座に hard delete で確定し、取り消せないため、
 * client は実行前に一段階の確認を挟む。この test はその確認フロー
 * （「参加しない」-> 確認 -> 確定 でカードが消える、キャンセルで pending に
 * 戻る）だけを検証する（DB を使わない）。
 */
describe("InvitationList", () => {
  beforeEach(() => {
    mockAccept.mockReset();
    mockDecline.mockReset();
    mockRefresh.mockReset();
  });

  it("removes the card only after decline is confirmed", async () => {
    const user = userEvent.setup();
    mockDecline.mockResolvedValue({ data: { snapshot: null } });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);

    await user.click(screen.getByRole("button", { name: "参加しない" }));

    // まだサーバへは何も送っていない - 確認待ちの状態。
    expect(mockDecline).not.toHaveBeenCalled();
    expect(
      screen.getByText("参加しないにしますか？あとから取り消せません。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "はい、参加しない" }));

    expect(mockDecline).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
    });
    expect(await screen.findByText("招待はありません。")).toBeInTheDocument();
  });

  it("returns to pending without calling the server when decline is canceled", async () => {
    const user = userEvent.setup();

    render(<InvitationList initialInvitations={[buildInvitation()]} />);

    await user.click(screen.getByRole("button", { name: "参加しない" }));
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(mockDecline).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "参加する" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "参加しない" }),
    ).toBeInTheDocument();
  });

  it("keeps the card visible when decline fails", async () => {
    const user = userEvent.setup();
    mockDecline.mockResolvedValue({
      serverError: { kind: "failure", message: "失敗しました。" },
    });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);
    await user.click(screen.getByRole("button", { name: "参加しない" }));
    await user.click(screen.getByRole("button", { name: "はい、参加しない" }));

    expect(mockDecline).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
    });
    expect(
      await screen.findByRole("button", { name: "参加する" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "「参加しない」: 失敗しました。",
    );
  });

  it("shows accept failure feedback and returns to actionable state", async () => {
    const user = userEvent.setup();
    mockAccept.mockResolvedValue({
      serverError: { kind: "failure", message: "参加できません。" },
    });

    render(<InvitationList initialInvitations={[buildInvitation()]} />);
    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(
      await screen.findByText("「参加する」: 参加できません。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "参加する" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "参加しない" })).toBeEnabled();
  });

  it("shows close failure feedback for a canceled invitation", async () => {
    const user = userEvent.setup();
    mockDecline.mockResolvedValue({
      serverError: { kind: "failure", message: "閉じられません。" },
    });

    render(
      <InvitationList
        initialInvitations={[buildInvitation({ canceled: true })]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));

    expect(
      await screen.findByText("「閉じる」: 閉じられません。"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "閉じる" })).toBeEnabled();
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
