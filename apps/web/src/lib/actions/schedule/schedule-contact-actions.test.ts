import { beforeEach, describe, expect, it, vi } from "vitest";

const CONTACT = "11111111-1111-4111-8111-111111111111";
const ENTRY = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";
const stub = { auth: { getUser: vi.fn() }, rpc: vi.fn(), from: vi.fn() };
const revalidate = vi.fn<(...args: unknown[]) => void>();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => stub,
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidate(...args),
}));
const actions = await import("./schedule-contact-actions");

const cases = [
  [
    "request_schedule_contact_by_email",
    () =>
      actions.requestScheduleContactAction({
        recipientEmail: "  A.B+Family@Example.TEST ",
      }),
    { p_recipient_email: "a.b+family@example.test" },
  ],
  [
    "cancel_schedule_contact_request_by_email",
    () =>
      actions.cancelScheduleContactRequestAction({
        recipientEmail: " B@Example.TEST ",
      }),
    { p_recipient_email: "b@example.test" },
  ],
  [
    "accept_schedule_contact_request",
    () => actions.acceptScheduleContactRequestAction({ requestId: REQUEST }),
    { p_request_id: REQUEST },
  ],
  [
    "decline_schedule_contact_request",
    () => actions.declineScheduleContactRequestAction({ requestId: REQUEST }),
    { p_request_id: REQUEST },
  ],
  [
    "set_schedule_contact_alias",
    () =>
      actions.setScheduleContactAliasAction({
        contactId: CONTACT,
        alias: "  妻  ",
      }),
    { p_contact_id: CONTACT, p_alias: "妻" },
  ],
  [
    "unlink_schedule_contact",
    () => actions.unlinkScheduleContactAction({ contactId: CONTACT }),
    { p_contact_id: CONTACT },
  ],
  [
    "share_schedule_entry_with_contact",
    () =>
      actions.shareScheduleEntryWithContactAction({
        contactId: CONTACT,
        entryId: ENTRY,
      }),
    { p_contact_id: CONTACT, p_schedule_entry_id: ENTRY },
  ],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  stub.auth.getUser.mockResolvedValue({
    data: { user: { id: USER } },
    error: null,
  });
  stub.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "schedule_contact_registration_enabled"
        ? true
        : { private: "not-returned" },
    error: null,
    status: 200,
  }));
});

describe("schedule contact Server Actions", () => {
  it.each(cases)(
    "%s uses the authenticated session and returns only an opaque acknowledgement",
    async (name, run, args) => {
      const result = await run();
      expect(result?.data).toEqual({ ok: true });
      expect(stub.auth.getUser).toHaveBeenCalledTimes(1);
      expect(stub.rpc.mock.calls).toEqual([
        ["schedule_contact_registration_enabled"],
        [name, args],
      ]);
      expect(stub.from).not.toHaveBeenCalled();
      if (name === "unlink_schedule_contact")
        expect(revalidate.mock.calls).toEqual([
          ["/mypage"],
          ["/"],
          ["/calendar"],
          ["/(app)/schedule/[entryId]", "page"],
        ]);
      else if (name === "share_schedule_entry_with_contact")
        expect(revalidate.mock.calls).toEqual([
          ["/calendar"],
          ["/"],
          [`/schedule/${ENTRY}`],
        ]);
      else expect(revalidate.mock.calls).toEqual([["/mypage"]]);
    },
  );
  it.each(cases)(
    "%s does not mutate or revalidate while the production gate is false",
    async (_name, run) => {
      stub.rpc.mockResolvedValue({ data: false, error: null, status: 200 });
      const result = await run();
      expect(result?.serverError).toMatchObject({ kind: "permission-denied" });
      expect(result?.data).toBeUndefined();
      expect(stub.rpc.mock.calls).toEqual([
        ["schedule_contact_registration_enabled"],
      ]);
      expect(revalidate).not.toHaveBeenCalled();
    },
  );
  it.each(cases)(
    "%s rejects an unauthenticated caller before RPC access",
    async (_name, run) => {
      stub.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });
      expect((await run())?.serverError).toMatchObject({
        kind: "unauthenticated",
      });
      expect(stub.rpc).not.toHaveBeenCalled();
      expect(revalidate).not.toHaveBeenCalled();
    },
  );
  it("rejects forged actor/owner/recipient ids rather than forwarding them to the DB", async () => {
    const forged = { ownerId: USER, recipientId: USER, userId: USER };
    const results = [
      await actions.shareScheduleEntryWithContactAction({
        entryId: ENTRY,
        contactId: CONTACT,
        ...forged,
      }),
      await actions.unlinkScheduleContactAction({
        contactId: CONTACT,
        ...forged,
      }),
      await actions.acceptScheduleContactRequestAction({
        requestId: REQUEST,
        ...forged,
      }),
    ];
    for (const result of results)
      expect(result?.validationErrors).toBeDefined();
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("validates malformed ids, email and alias length before RPC access", async () => {
    for (const result of [
      await actions.requestScheduleContactAction({
        recipientEmail: "not-email",
      }),
      await actions.shareScheduleEntryWithContactAction({
        contactId: "bad",
        entryId: ENTRY,
      }),
      await actions.acceptScheduleContactRequestAction({ requestId: "bad" }),
      await actions.setScheduleContactAliasAction({
        contactId: CONTACT,
        alias: "😀".repeat(81),
      }),
    ])
      expect(result?.validationErrors).toBeDefined();
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("preserves ownership/stale-generation rejection with no retry, raw detail or revalidation", async () => {
    stub.rpc
      .mockResolvedValueOnce({ data: true, error: null, status: 200 })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42501", message: "secret@example.test" },
        status: 403,
      });
    const result = await actions.shareScheduleEntryWithContactAction({
      contactId: CONTACT,
      entryId: ENTRY,
    });
    expect(result?.serverError).toMatchObject({ kind: "permission-denied" });
    expect(JSON.stringify(result)).not.toContain("secret@example.test");
    expect(stub.rpc).toHaveBeenCalledTimes(2);
    expect(revalidate).not.toHaveBeenCalled();
  });
  it("does not convert a failed capability read into an enabled or empty success", async () => {
    stub.rpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "private" },
      status: 500,
    });
    expect(
      (await actions.unlinkScheduleContactAction({ contactId: CONTACT }))
        ?.serverError,
    ).toMatchObject({ kind: "failure" });
    expect(stub.rpc).toHaveBeenCalledTimes(1);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
