import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { personalScheduleEntryIdSchema } from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteEntryButton } from "./DeleteEntryButton";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  result: { serverError: undefined as { message: string } | undefined },
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({
    execute: mocks.execute,
    isExecuting: false,
    result: mocks.result,
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
    mocks.result.serverError = undefined;
  });

  it("explains that deletion also removes the entry from shared recipients", async () => {
    const user = userEvent.setup();
    render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "共有相手からもこの予定が見えなくなります。",
    );
  });

  it("shows owner delete failure feedback and keeps the confirmation available", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeleteEntryButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "削除する" }));
    await user.click(screen.getByRole("button", { name: "削除する" }));
    expect(mocks.execute).toHaveBeenCalledWith({ entryId });

    mocks.result.serverError = { message: "この予定を削除できません。" };
    rerender(<DeleteEntryButton entryId={entryId} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "この予定を削除できません。",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
