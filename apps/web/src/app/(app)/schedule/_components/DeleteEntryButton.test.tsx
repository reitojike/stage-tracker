import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { personalScheduleEntryIdSchema } from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteEntryButton } from "./DeleteEntryButton";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reset: vi.fn(),
  result: { serverError: undefined as { message: string } | undefined },
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: mocks.execute,
    isExecuting: false,
    result: mocks.result,
    reset: mocks.reset,
  }),
}));

vi.mock("@/lib/actions/schedule/schedule-entry-actions", () => ({
  deleteScheduleEntryAction: {},
}));

describe("DeleteEntryButton", () => {
  const entryId = personalScheduleEntryIdSchema.parse(
    "11111111-1111-4111-8111-111111111111",
  );

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.reset.mockImplementation(() => {
      mocks.result.serverError = undefined;
    });
    mocks.result.serverError = undefined;
  });

  it("opens a confirmation Sheet and explains the shared-recipient impact", async () => {
    const user = userEvent.setup();
    render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(
      screen.getByRole("alertdialog", { name: "予定の削除の確認" }),
    ).toHaveTextContent("共有相手からもこの予定が見えなくなります。");
  });

  it("does not delete when the confirmation Sheet is dismissed", async () => {
    const user = userEvent.setup();
    render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "予定の削除の確認",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "予定の削除の確認" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("shows owner delete failure feedback and keeps the confirmation available", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "予定の削除の確認" }),
      ).getByRole("button", { name: "削除する" }),
    );
    expect(mocks.execute).toHaveBeenCalledWith({ entryId });

    mocks.result.serverError = { message: "この予定を削除できません。" };
    rerender(<DeleteEntryButton entryId={entryId} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "この予定を削除できません。",
    );
    expect(
      screen.getByRole("alertdialog", { name: "予定の削除の確認" }),
    ).toBeInTheDocument();
  });

  it("clears a previous delete failure when canceling and reopening confirmation", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));
    await user.click(
      within(
        screen.getByRole("alertdialog", { name: "予定の削除の確認" }),
      ).getByRole("button", { name: "削除する" }),
    );
    mocks.result.serverError = { message: "この予定を削除できません。" };
    rerender(<DeleteEntryButton entryId={entryId} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(mocks.reset).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "予定の削除の確認" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(
      screen.getByRole("alertdialog", { name: "予定の削除の確認" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
