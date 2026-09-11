import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { personalScheduleEntryIdSchema } from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveShareButton } from "./LeaveShareButton";

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

vi.mock("@/lib/actions/schedule/schedule-share-actions", () => ({
  removeScheduleShareAction: {},
}));

describe("LeaveShareButton", () => {
  const entryId = personalScheduleEntryIdSchema.parse(
    "11111111-1111-4111-8111-111111111111",
  );

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.result.serverError = undefined;
  });

  it("shows self-leave failure feedback without changing its operation wording", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<LeaveShareButton entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "共有から外れる" }));
    expect(mocks.execute).toHaveBeenCalledWith({ entryId });

    mocks.result.serverError = { message: "共有から外れませんでした。" };
    rerender(<LeaveShareButton entryId={entryId} />);

    expect(
      screen.getByRole("button", { name: "共有から外れる" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "共有から外れませんでした。",
    );
  });
});
