import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { deletePasskeyAction } from "@/lib/actions/passkeys";
import { DeletePasskeyForm } from "./DeletePasskeyForm";

// `deletePasskeyAction` transitively pulls in `src/env.ts` via
// `next-safe-action`/`createPasskeyServerClient` - not available/valid in
// this unit test's environment. Mock it out the same way
// `ParticipationControls.test.tsx`/`TicketOpportunityStateControls.test.tsx`
// mock their own `.actions` module.
vi.mock("@/lib/actions/passkeys", () => ({
  deletePasskeyAction: vi.fn(),
}));

const mockedAction = vi.mocked(deletePasskeyAction);

describe("DeletePasskeyForm", () => {
  it("gives the delete button an accessible name that identifies which passkey it acts on (WCAG 2.2 AA baseline, docs/ux-ui.md)", () => {
    // 可視テキストの「削除」は全行で同一のため、複数 Passkey 登録時に
    // screen reader が区別できるよう aria-label に passkeyLabel を含める
    // 必要がある（legacy の DeletePasskeyForm.tsx、PR #129 の Codex
    // finding と同じ理由）。
    render(
      <DeletePasskeyForm
        passkeyId="11111111-1111-4111-8111-111111111111"
        passkeyLabel="iPhone — 2026-01-01 12:00"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "iPhone — 2026-01-01 12:00を削除",
      }),
    ).toBeInTheDocument();
  });

  it("renders distinct accessible names for two rows sharing the same visible '削除' text", () => {
    render(
      <>
        <DeletePasskeyForm passkeyId="id-a" passkeyLabel="端末A" />
        <DeletePasskeyForm passkeyId="id-b" passkeyLabel="端末B" />
      </>,
    );

    expect(
      screen.getByRole("button", { name: "端末Aを削除" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "端末Bを削除" }),
    ).toBeInTheDocument();
  });

  it("calls the action with the passkey id when clicked", async () => {
    mockedAction.mockResolvedValueOnce({ data: undefined });
    const user = userEvent.setup();

    render(
      <DeletePasskeyForm
        passkeyId="22222222-2222-4222-8222-222222222222"
        passkeyLabel="iPhone — 2026-01-01 12:00"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "iPhone — 2026-01-01 12:00を削除" }),
    );

    expect(mockedAction).toHaveBeenCalledWith({
      passkeyId: "22222222-2222-4222-8222-222222222222",
    });
  });
});
