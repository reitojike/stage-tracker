import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { personalScheduleEntryIdSchema } from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareAddForm } from "./ShareAddForm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  reset: vi.fn(),
  refresh: vi.fn(),
  onSuccess: undefined as (() => void) | undefined,
  result: {
    serverError: undefined as { message: string } | undefined,
    validationErrors: undefined as
      { recipientEmail?: { _errors?: string[] } } | undefined,
  },
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: (_action: unknown, options?: { onSuccess?: () => void }) => {
    mocks.onSuccess = options?.onSuccess;
    return {
      execute: mocks.execute,
      isExecuting: false,
      result: mocks.result,
      reset: mocks.reset,
    };
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/actions/schedule/schedule-share-actions", () => ({
  addScheduleShareByEmailAction: {},
}));

describe("ShareAddForm", () => {
  const entryId = personalScheduleEntryIdSchema.parse(
    "11111111-1111-4111-8111-111111111111",
  );

  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.reset.mockReset();
    mocks.refresh.mockReset();
    mocks.onSuccess = undefined;
    mocks.result.serverError = undefined;
    mocks.result.validationErrors = undefined;
  });

  it("opens the shared Sheet from the owner add affordance", async () => {
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} />);

    expect(
      screen.queryByRole("heading", { name: "共有相手を追加" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ 追加" }));

    expect(
      screen.getByRole("heading", { name: "共有相手を追加" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/共有する相手のメールアドレス/),
    ).toBeInTheDocument();
  });

  it("resets the transient input, refreshes the owner state, and closes after success", async () => {
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    const input = screen.getByLabelText(/共有する相手のメールアドレス/);
    await user.type(input, "friend@example.com");
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(mocks.execute).toHaveBeenCalledWith({
      entryId,
      recipientEmail: "friend@example.com",
    });

    act(() => {
      mocks.onSuccess?.();
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "共有相手を追加" }),
      ).not.toBeInTheDocument(),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    expect(screen.getByLabelText(/共有する相手のメールアドレス/)).toHaveValue(
      "",
    );
  });

  it("keeps the Sheet open and preserves input for validation errors", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ShareAddForm entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    const input = screen.getByLabelText(/共有する相手のメールアドレス/);
    await user.type(input, "not-an-email");
    mocks.result.validationErrors = {
      recipientEmail: { _errors: ["メールアドレスの形式が正しくありません。"] },
    };
    rerender(<ShareAddForm entryId={entryId} />);

    expect(
      screen.getByRole("heading", { name: "共有相手を追加" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "メールアドレスの形式が正しくありません。",
    );
    expect(input).toHaveValue("not-an-email");
  });

  it.each([
    [
      "unregistered email",
      "このメールアドレスは、Stage Trackerに登録されていません。",
    ],
    ["server failure", "共有を追加できませんでした。"],
  ])("keeps the Sheet open and shows %s feedback", async (_kind, message) => {
    const user = userEvent.setup();
    const { rerender } = render(<ShareAddForm entryId={entryId} />);

    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    const input = screen.getByLabelText(/共有する相手のメールアドレス/);
    await user.type(input, "friend@example.com");
    mocks.result.serverError = { message };
    rerender(<ShareAddForm entryId={entryId} />);

    expect(
      screen.getByRole("heading", { name: "共有相手を追加" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(input).toHaveValue("friend@example.com");
  });
});
