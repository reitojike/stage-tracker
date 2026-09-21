import { beforeEach, describe, expect, it, vi } from "vitest";

const OCCURRENCE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mockGetUser = vi.fn();
const mockInviteToOccurrenceByEmail = vi.fn();
const mockRevalidateReadSurfaces = vi.fn();
const supabaseStub = {
  auth: { getUser: mockGetUser },
};

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));

vi.mock("@/lib/revalidation", () => ({
  affectedReadSurfaces: {
    invitationCreate: vi.fn(() => []),
  },
  revalidateReadSurfaces: mockRevalidateReadSurfaces,
}));

vi.mock("./invitation", () => ({
  inviteToOccurrenceByEmail: mockInviteToOccurrenceByEmail,
}));

const { inviteToOccurrenceAction } = await import("./invitation.actions.js");

describe("inviteToOccurrenceAction authenticated identity context", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockInviteToOccurrenceByEmail.mockReset();
    mockRevalidateReadSurfaces.mockReset();
    mockInviteToOccurrenceByEmail.mockResolvedValue({
      ok: true,
      value: "invite-sent",
    });
  });

  it("uses the middleware email and keeps the opaque result with one auth lookup", async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: { id: USER_ID, email: "inviter@example.com" },
      },
      error: null,
    });

    const result = await inviteToOccurrenceAction({
      occurrenceId: OCCURRENCE_ID,
      email: "  Invitee@Example.COM ",
    });

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockInviteToOccurrenceByEmail).toHaveBeenCalledWith(supabaseStub, {
      occurrenceId: OCCURRENCE_ID,
      inviterUserId: USER_ID,
      inviterEmail: "inviter@example.com",
      inviteeEmail: "invitee@example.com",
    });
    expect(result.data).toEqual({ outcome: "invite-sent" });
  });

  it("preserves null inviter email semantics", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });

    const result = await inviteToOccurrenceAction({
      occurrenceId: OCCURRENCE_ID,
      email: "invitee@example.com",
    });

    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockInviteToOccurrenceByEmail).toHaveBeenCalledWith(
      supabaseStub,
      expect.objectContaining({ inviterEmail: null }),
    );
    expect(result.data).toEqual({ outcome: "invite-sent" });
  });
});
