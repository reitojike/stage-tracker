import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  receivedScheduleContactRequestSchema,
  scheduleContactSchema,
} from "@stage-tracker/domain";
import { RequestContactForm } from "./RequestContactForm";
import { ReceivedContactRequests } from "./ReceivedContactRequests";
import { ScheduleContactList } from "./ScheduleContactList";
type Reply = {
  data?: { ok: true };
  serverError?: { kind: "permission-denied"; message: string };
  validationErrors?: {
    alias?: { _errors: string[] };
    recipientEmail?: { _errors: string[] };
  };
};
const mocks = vi.hoisted(() => {
  const action = () => vi.fn<(input: unknown) => Promise<Reply>>();
  return {
    request: action(),
    cancel: action(),
    accept: action(),
    decline: action(),
    alias: action(),
    unlink: action(),
    refresh: vi.fn<() => void>(),
  };
});
vi.mock("@/lib/actions/schedule/schedule-contact-actions", () => ({
  requestScheduleContactAction: mocks.request,
  cancelScheduleContactRequestAction: mocks.cancel,
  acceptScheduleContactRequestAction: mocks.accept,
  declineScheduleContactRequestAction: mocks.decline,
  setScheduleContactAliasAction: mocks.alias,
  unlinkScheduleContactAction: mocks.unlink,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
const contact = scheduleContactSchema.parse({
  contactId: "11111111-1111-4111-8111-111111111111",
  counterpartEmail: "b@example.test",
  ownAlias: "妻",
  acceptedAt: "2026-10-16T00:00:00Z",
});
const request = receivedScheduleContactRequestSchema.parse({
  requestId: "22222222-2222-4222-8222-222222222222",
  requesterEmail: "a@example.test",
  requestedAt: "2026-10-16T00:00:00Z",
});
beforeEach(() => {
  for (const action of [
    mocks.request,
    mocks.cancel,
    mocks.accept,
    mocks.decline,
    mocks.alias,
    mocks.unlink,
  ])
    action.mockReset().mockResolvedValue({ data: { ok: true } });
  mocks.refresh.mockReset();
});

describe("contact request controls", () => {
  it("uses the same acknowledgement for known/unknown emails and has no outgoing list", async () => {
    const user = userEvent.setup();
    render(<RequestContactForm />);
    for (const email of ["known@example.test", "unknown@example.test"]) {
      await user.type(screen.getByRole("textbox"), email);
      await user.click(screen.getByRole("button", { name: "登録を申請する" }));
      expect(await screen.findByRole("status")).toHaveTextContent(
        "申請を受け付けました。",
      );
      expect(screen.getByRole("textbox")).toHaveValue("");
      expect(screen.queryByText(email)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/送信済み|申請中の相手/),
      ).not.toBeInTheDocument();
    }
    expect(mocks.request).toHaveBeenNthCalledWith(1, {
      recipientEmail: "known@example.test",
    });
    expect(mocks.request).toHaveBeenNthCalledWith(2, {
      recipientEmail: "unknown@example.test",
    });
  });
  it("cancels by the original input email without an existence result", async () => {
    const user = userEvent.setup();
    render(<RequestContactForm />);
    await user.type(screen.getByRole("textbox"), "old@example.test");
    await user.click(screen.getByRole("button", { name: "申請を取り消す" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "取消の操作を受け付けました。",
    );
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      recipientEmail: "old@example.test",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("preserves invalid input on validation error", async () => {
    mocks.request.mockResolvedValue({
      validationErrors: {
        recipientEmail: { _errors: ["入力内容を確認してください。"] },
      },
    });
    const user = userEvent.setup();
    render(<RequestContactForm />);
    await user.type(screen.getByRole("textbox"), "bad");
    await user.click(screen.getByRole("button", { name: "登録を申請する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "メールアドレスを確認してください。",
    );
    expect(screen.getByRole("textbox")).toHaveValue("bad");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("disables request and cancellation together while a submission is pending", async () => {
    let finish: (() => void) | undefined;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { ok: true } });
        }),
    );
    const user = userEvent.setup();
    render(<RequestContactForm />);
    await user.type(screen.getByRole("textbox"), "a@example.test");
    await user.click(screen.getByRole("button", { name: "登録を申請する" }));
    expect(screen.getByRole("button", { name: "申請中…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "申請を取り消す" }),
    ).toBeDisabled();
    await act(async () => {
      finish?.();
    });
    await screen.findByRole("status");
  });
});

describe("received requests", () => {
  it("accepts only the request id and waits for authoritative refresh without granting a schedule", async () => {
    const user = userEvent.setup();
    const view = render(<ReceivedContactRequests requests={[request]} />);
    await user.click(
      screen.getByRole("button", { name: "a@example.testからの申請を承認" }),
    );
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({
      requestId: request.requestId,
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
    view.rerender(<ReceivedContactRequests requests={[]} />);
    expect(screen.getByText("届いた申請はありません")).toBeInTheDocument();
  });
  it("keeps a rejected response on screen and exposes no undo or refusal history", async () => {
    mocks.decline.mockResolvedValue({
      serverError: {
        kind: "permission-denied",
        message: "対象を操作できません。",
      },
    });
    const user = userEvent.setup();
    render(<ReceivedContactRequests requests={[request]} />);
    await user.click(
      screen.getByRole("button", { name: "a@example.testからの申請を拒否" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "対象を操作できません。",
    );
    expect(mocks.decline).toHaveBeenCalledExactlyOnceWith({
      requestId: request.requestId,
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /元に戻す/ }),
    ).not.toBeInTheDocument();
  });
});

describe("accepted contact controls", () => {
  it("edits only the caller alias, including blank clearing, without changing the counterpart email", async () => {
    const user = userEvent.setup();
    render(<ScheduleContactList contacts={[contact]} />);
    expect(screen.getByText("妻")).toBeInTheDocument();
    expect(screen.getByText("b@example.test")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "自分用の呼び名" }));
    await user.click(screen.getByRole("button", { name: "呼び名を保存する" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.alias).toHaveBeenCalledExactlyOnceWith({
      contactId: contact.contactId,
      alias: "",
    });
  });
  it("shows alias validation without clearing the entered value", async () => {
    mocks.alias.mockResolvedValue({
      validationErrors: {
        alias: { _errors: ["80文字以内で入力してください。"] },
      },
    });
    const user = userEvent.setup();
    render(<ScheduleContactList contacts={[contact]} />);
    const input = screen.getByRole("textbox", { name: "自分用の呼び名" });
    await user.clear(input);
    await user.type(input, "x".repeat(81));
    await user.click(screen.getByRole("button", { name: "呼び名を保存する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "呼び名を確認してください（80文字以内）。",
    );
    expect(input).toHaveValue("x".repeat(81));
  });
  it("requires explicit destructive confirmation, focuses cancel, and refreshes after unlink", async () => {
    const user = userEvent.setup();
    render(<ScheduleContactList contacts={[contact]} />);
    const trigger = screen.getByRole("button", { name: "妻の登録を解除" });
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("両方向");
    expect(dialog).toHaveTextContent("予定本体は削除されません");
    expect(dialog).toHaveTextContent("再登録しても過去の共有は戻りません");
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "キャンセル" }),
      ).toHaveFocus(),
    );
    expect(mocks.unlink).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", { name: "登録と両方向の共有を解除する" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mocks.unlink).toHaveBeenCalledExactlyOnceWith({
      contactId: contact.contactId,
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not close or retry a failed stale-generation unlink", async () => {
    mocks.unlink.mockResolvedValue({
      serverError: {
        kind: "permission-denied",
        message: "対象を操作できません。",
      },
    });
    const user = userEvent.setup();
    render(<ScheduleContactList contacts={[contact]} />);
    await user.click(screen.getByRole("button", { name: "妻の登録を解除" }));
    await user.click(
      screen.getByRole("button", { name: "登録と両方向の共有を解除する" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "対象を操作できません。",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(mocks.unlink).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not revive a private alias when a newly accepted generation replaces the old row", () => {
    const view = render(<ScheduleContactList contacts={[contact]} />);
    const fresh = scheduleContactSchema.parse({
      ...contact,
      contactId: request.requestId,
      ownAlias: null,
    });
    view.rerender(<ScheduleContactList contacts={[fresh]} />);
    expect(screen.queryByText("妻")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "自分用の呼び名" })).toHaveValue(
      "",
    );
    expect(mocks.alias).not.toHaveBeenCalled();
    expect(mocks.unlink).not.toHaveBeenCalled();
  });
});
