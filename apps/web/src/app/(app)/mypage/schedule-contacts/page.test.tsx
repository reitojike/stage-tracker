import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  receivedScheduleContactRequestSchema,
  scheduleContactSchema,
} from "@stage-tracker/domain";
import {
  getScheduleContactRegistrationEnabled,
  listReceivedScheduleContactRequests,
  listScheduleContacts,
} from "@/lib/data/reads/scheduleContact";
import Page from "./page";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: auth } }),
}));
vi.mock("@/lib/data/reads/scheduleContact", () => ({
  getScheduleContactRegistrationEnabled: vi.fn(),
  listReceivedScheduleContactRequests: vi.fn(),
  listScheduleContacts: vi.fn(),
}));
vi.mock("./_components/RequestContactForm", () => ({
  RequestContactForm: () => <div>request controls</div>,
}));
vi.mock("./_components/ReceivedContactRequests", () => ({
  ReceivedContactRequests: () => <div>received controls</div>,
}));
vi.mock("./_components/ScheduleContactList", () => ({
  ScheduleContactList: () => <div>contact controls</div>,
}));
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ data: { user: { id } }, error: null });
  vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
    ok: true,
    value: true,
  });
  vi.mocked(listReceivedScheduleContactRequests).mockResolvedValue({
    ok: true,
    value: [
      receivedScheduleContactRequestSchema.parse({
        requestId: id,
        requesterEmail: "a@example.test",
        requestedAt: "2026-10-16T00:00:00Z",
      }),
    ],
  });
  vi.mocked(listScheduleContacts).mockResolvedValue({
    ok: true,
    value: [
      scheduleContactSchema.parse({
        contactId: id,
        counterpartEmail: "b@example.test",
        ownAlias: null,
        acceptedAt: "2026-10-16T00:00:00Z",
      }),
    ],
  });
});
describe("schedule contact route", () => {
  it("does not read private lists or show operations while registration is disabled", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: true,
      value: false,
    });
    render(await Page());
    expect(screen.getByText("共有相手の登録は準備中です")).toBeInTheDocument();
    expect(listScheduleContacts).not.toHaveBeenCalled();
    expect(listReceivedScheduleContactRequests).not.toHaveBeenCalled();
    expect(screen.queryByText("request controls")).not.toBeInTheDocument();
  });
  it("keeps capability read failure separate from disabled and does not render operations", async () => {
    vi.mocked(getScheduleContactRegistrationEnabled).mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "secret" },
    });
    render(await Page());
    expect(
      screen.getByText("共有相手の登録を確認できませんでした"),
    ).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
    expect(listScheduleContacts).not.toHaveBeenCalled();
  });
  it("requires the authenticated session before capability or private reads", async () => {
    auth.mockResolvedValue({ data: { user: null }, error: null });
    render(await Page());
    expect(
      screen.getByText("サインイン状態を確認できません"),
    ).toBeInTheDocument();
    expect(getScheduleContactRegistrationEnabled).not.toHaveBeenCalled();
  });
  it("renders only the enabled management controls and explains no automatic sharing", async () => {
    render(await Page());
    expect(screen.getByText("request controls")).toBeInTheDocument();
    expect(screen.getByText("received controls")).toBeInTheDocument();
    expect(screen.getByText("contact controls")).toBeInTheDocument();
    expect(
      screen.getByText(/登録しただけでは予定は共有されません/),
    ).toBeInTheDocument();
  });
  it("does not hide accepted contacts because the independent incoming list failed", async () => {
    vi.mocked(listReceivedScheduleContactRequests).mockResolvedValue({
      ok: false,
      error: { kind: "failure", message: "secret" },
    });
    render(await Page());
    expect(
      screen.getByText("届いた申請を読み込めませんでした"),
    ).toBeInTheDocument();
    expect(screen.getByText("contact controls")).toBeInTheDocument();
    expect(screen.queryByText("received controls")).not.toBeInTheDocument();
  });
});
