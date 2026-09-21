import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR #384 review への回帰テスト: `acceptInvitationAction` が participation の
 * 書き込みを独自に組み直しており、PR #383 が `setParticipationChoice` 側で
 * 直した 0 行 UPDATE race（SELECT と UPDATE の間に対象行が並行 withdraw で
 * 消えても PostgREST は成功を返す）を、こちらだけが抱えたままだった。
 *
 * accept は「通常の participation write と全く同一の operation」であるという
 * specs/001-occurrence-participation/spec.md / decisions.md の決定を、コード上でも成立させる。ここで検証するのは
 * **canonical な write boundary を本当に通っているか**であり、race の処理そのもの
 * ではない（それは `participation.test.ts` の担当）。
 *
 * `authActionClient`（`@/lib/safe-action.ts`）が使う `createSupabaseServerClient`
 * を差し替えて認証済み扱いにし、`setParticipationChoice` を spy にする。
 */

const OCCURRENCE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";

const mockSetParticipationChoice = vi.fn<(...args: unknown[]) => unknown>();
const mockRevalidatePath = vi.fn<(...args: unknown[]) => unknown>();
const occurrenceQuery = {
  select: vi.fn(() => occurrenceQuery),
  eq: vi.fn(() => occurrenceQuery),
  maybeSingle: vi.fn(async () => ({
    data: { event_id: EVENT_ID },
    error: null,
  })),
};
const supabaseStub = {
  auth: { getUser: vi.fn() },
  from: vi.fn(() => occurrenceQuery),
  rpc: vi.fn(),
};

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => supabaseStub),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("./participation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./participation.js")>();
  return {
    ...actual,
    setParticipationChoice: (...args: unknown[]) =>
      mockSetParticipationChoice(...args),
  };
});

const { acceptInvitationAction, declineInvitationAction } =
  await import("./invitations.js");

function signedIn() {
  supabaseStub.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
}

describe("acceptInvitationAction", () => {
  beforeEach(() => {
    mockSetParticipationChoice.mockReset();
    mockRevalidatePath.mockReset();
    occurrenceQuery.select.mockClear();
    occurrenceQuery.eq.mockClear();
    occurrenceQuery.maybeSingle.mockClear();
    supabaseStub.rpc.mockReset();
  });

  it("participation の canonical write boundary をそのまま呼ぶ", async () => {
    signedIn();
    mockSetParticipationChoice.mockResolvedValue({
      ok: true,
      value: undefined,
    });

    const result = await acceptInvitationAction({
      occurrenceId: OCCURRENCE_ID,
    });

    expect(mockSetParticipationChoice).toHaveBeenCalledTimes(1);
    expect(mockSetParticipationChoice).toHaveBeenCalledWith(supabaseStub, {
      occurrenceId: OCCURRENCE_ID,
      userId: USER_ID,
      choice: "attending",
    });
    expect(mockRevalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/catalog/events/${EVENT_ID}`,
      "/calendar",
      "/",
      "/catalog/invitations",
      "/mypage",
    ]);
    expect(result.data).toEqual({ ok: true });
  });

  it("write boundary が失敗を返したら成功扱いにせず、revalidate もしない", async () => {
    signedIn();
    mockRevalidatePath.mockClear();
    // setParticipationChoice が 0 行 race を検出したときの形
    // （participation.ts の CONCURRENT_WRITE_LOST）。
    mockSetParticipationChoice.mockResolvedValue({
      ok: false,
      error: {
        kind: "failure",
        message: "参加状態を更新できませんでした。もう一度お試しください。",
      },
    });

    const result = await acceptInvitationAction({
      occurrenceId: OCCURRENCE_ID,
    });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBeDefined();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("decline は RPC の返却 row を公開せず、成功 lifecycle だけを返す", async () => {
    signedIn();
    supabaseStub.rpc.mockResolvedValue({
      data: {
        occurrence_id: OCCURRENCE_ID,
        inviter_id: USER_ID,
        invitee_id: USER_ID,
      },
      error: null,
    });

    const result = await declineInvitationAction({
      invitationId: OCCURRENCE_ID,
    });

    expect(supabaseStub.rpc).toHaveBeenCalledWith(
      "decline_occurrence_invitation",
      { p_invitation_id: OCCURRENCE_ID },
    );
    expect(result.data).toEqual({ ok: true });
    expect(result.data).not.toHaveProperty("snapshot");
  });
});
