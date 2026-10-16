import { createClient } from "@supabase/supabase-js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  personalScheduleEntryIdSchema,
  scheduleContactSchema,
} from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import {
  getScheduleContactRegistrationEnabled,
  listScheduleContacts,
} from "@/lib/data/reads/scheduleContact";
import { ContactSharePicker } from "./ContactSharePicker";
vi.mock("@/lib/data/reads/scheduleContact", () => ({
  getScheduleContactRegistrationEnabled: vi.fn(),
  listScheduleContacts: vi.fn(),
}));
vi.mock("./ShareAddForm", () => ({
  ShareAddForm: () => <div>accepted selector</div>,
}));
const client = createClient<Database>("https://picker.supabase.test", "anon", {
  auth: { persistSession: false },
});
const entryId = personalScheduleEntryIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
beforeEach(() => vi.clearAllMocks());
describe("contact share capability boundary", () => {
  it("does not read contacts or offer legacy email sharing while disabled", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: true,
      value: false,
    });
    render(await ContactSharePicker({ supabase: client, entryId }));
    expect(screen.getByText(/新しい共有の追加は準備中/)).toBeInTheDocument();
    expect(listScheduleContacts).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("accepted selector")).not.toBeInTheDocument();
  });
  it("keeps a capability read failure separate from disabled or empty", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "private" },
    });
    render(await ContactSharePicker({ supabase: client, entryId }));
    expect(
      screen.getByText("共有相手の選択を確認できませんでした"),
    ).toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(listScheduleContacts).not.toHaveBeenCalled();
  });
  it("does not render an enabled selector for a failed list", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: true,
      value: true,
    });
    vi.mocked(listScheduleContacts).mockResolvedValue({
      ok: false,
      error: { kind: "permission-denied", message: "private" },
    });
    render(await ContactSharePicker({ supabase: client, entryId }));
    expect(
      screen.getByText("共有相手を読み込めませんでした"),
    ).toBeInTheDocument();
    expect(screen.queryByText("accepted selector")).not.toBeInTheDocument();
  });
  it("renders the typed selector only after a successful enabled list", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: true,
      value: true,
    });
    vi.mocked(listScheduleContacts).mockResolvedValue({
      ok: true,
      value: [
        scheduleContactSchema.parse({
          contactId: entryId,
          counterpartEmail: "b@example.test",
          ownAlias: null,
          acceptedAt: "2026-10-16T00:00:00Z",
        }),
      ],
    });
    render(await ContactSharePicker({ supabase: client, entryId }));
    expect(screen.getByText("accepted selector")).toBeInTheDocument();
  });
});
