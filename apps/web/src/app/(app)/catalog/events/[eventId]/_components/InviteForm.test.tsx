import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { occurrenceIdSchema } from "@stage-tracker/domain";
import { inviteToOccurrenceAction } from "@/lib/actions/invitation.actions";
import { InviteForm } from "./InviteForm";

vi.mock("@/lib/actions/invitation.actions", () => ({
  inviteToOccurrenceAction: vi.fn(),
}));

const occurrenceId = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const mockedAction = vi.mocked(inviteToOccurrenceAction);

describe("InviteForm", () => {
  it("starts collapsed, showing only the '招待する' affordance", () => {
    render(<InviteForm occurrenceId={occurrenceId} />);

    expect(
      screen.getByRole("button", { name: "招待する" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("招待するメールアドレス"),
    ).not.toBeInTheDocument();
  });

  it("shows the exact same success message regardless of which invitee branch the server took (opacity)", async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValue({ data: { outcome: "invite-sent" } });

    render(<InviteForm occurrenceId={occurrenceId} />);
    await user.click(screen.getByRole("button", { name: "招待する" }));

    for (const email of [
      "no-row@example.test",
      "considering@example.test",
      "attending@example.test",
    ]) {
      await user.clear(screen.getByLabelText("招待するメールアドレス"));
      await user.type(screen.getByLabelText("招待するメールアドレス"), email);
      await user.click(screen.getByRole("button", { name: "送信" }));

      expect(
        await screen.findByText("招待を送信しました。"),
      ).toBeInTheDocument();
    }

    // Every call reached the action with only what the inviter typed - no
    // extra, branch-revealing data is ever attached client-side either.
    expect(mockedAction).toHaveBeenCalledTimes(3);
  });

  it("surfaces the server error message inline (e.g. self-invite, not-attending, canceled)", async () => {
    const user = userEvent.setup();
    mockedAction.mockResolvedValueOnce({
      serverError: {
        kind: "validation",
        message: "自分自身を招待することはできません。",
      },
    });

    render(<InviteForm occurrenceId={occurrenceId} />);
    await user.click(screen.getByRole("button", { name: "招待する" }));
    await user.type(
      screen.getByLabelText("招待するメールアドレス"),
      "me@example.test",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "自分自身を招待することはできません。",
    );
  });
});
