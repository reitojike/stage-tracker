import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  personalScheduleEntryIdSchema,
  scheduleContactSchema,
} from "@stage-tracker/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareAddForm } from "./ShareAddForm";

type Reply = {
  data?: { ok: true };
  serverError?: { kind: "permission-denied"; message: string };
  validationErrors?: { contactId: { _errors: string[] } };
};
const mocks = vi.hoisted(() => ({
  action: vi.fn<(input: unknown) => Promise<Reply>>(),
  refresh: vi.fn<() => void>(),
}));
vi.mock("@/lib/actions/schedule/schedule-contact-actions", () => ({
  shareScheduleEntryWithContactAction: mocks.action,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
const entryId = personalScheduleEntryIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const contact = scheduleContactSchema.parse({
  contactId: "22222222-2222-4222-8222-222222222222",
  counterpartEmail: "b@example.test",
  ownAlias: "妻",
  acceptedAt: "2026-10-16T00:00:00Z",
});

beforeEach(() => {
  mocks.action.mockReset().mockResolvedValue({ data: { ok: true } });
  mocks.refresh.mockReset();
});
describe("registered contact share selector", () => {
  it("selects a generation rather than entering email, then refreshes and resets the Sheet", async () => {
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} contacts={[contact]} />);
    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: /共有する相手/ }),
      contact.contactId,
    );
    expect(
      screen.getByRole("option", { name: "妻（b@example.test）" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "追加する" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.action).toHaveBeenCalledExactlyOnceWith({
      entryId,
      contactId: contact.contactId,
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
  it("supports Escape and restores focus to the add affordance", async () => {
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} contacts={[contact]} />);
    const add = screen.getByRole("button", { name: "+ 追加" });
    add.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(add).toHaveFocus();
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("shows missing-selection validation without closing or returning to email entry", async () => {
    mocks.action.mockResolvedValue({
      validationErrors: {
        contactId: { _errors: ["相手を選択してください。"] },
      },
    });
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} contacts={[contact]} />);
    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "共有する相手を選択してください。",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
  it("refreshes a stale-generation rejection without retrying or claiming success", async () => {
    mocks.action.mockResolvedValue({
      serverError: {
        kind: "permission-denied",
        message: "対象を操作できません。",
      },
    });
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} contacts={[contact]} />);
    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    await user.selectOptions(screen.getByRole("combobox"), contact.contactId);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "対象を操作できません。",
    );
    expect(mocks.action).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("does not offer sharing when there are no accepted contacts", () => {
    render(<ShareAddForm entryId={entryId} contacts={[]} />);
    expect(
      screen.getByRole("link", { name: "共有相手を登録する" }),
    ).toHaveAttribute("href", "/mypage/schedule-contacts");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("prevents a second submit and closing while a share is in flight", async () => {
    let finish: (() => void) | undefined;
    mocks.action.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { ok: true } });
        }),
    );
    const user = userEvent.setup();
    render(<ShareAddForm entryId={entryId} contacts={[contact]} />);
    await user.click(screen.getByRole("button", { name: "+ 追加" }));
    await user.selectOptions(screen.getByRole("combobox"), contact.contactId);
    await user.click(screen.getByRole("button", { name: "追加する" }));
    expect(screen.getByRole("button", { name: "追加中…" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.action).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish?.();
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
