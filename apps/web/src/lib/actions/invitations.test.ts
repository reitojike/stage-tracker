import { describe, expect, it, vi } from "vitest";

/**
 * PR #384 review への回帰テスト: `acceptInvitationAction` が participation の
 * 書き込みを独自に組み直しており、PR #383 が `setParticipationChoice` 側で
 * 直した 0 行 UPDATE race（SELECT と UPDATE の間に対象行が並行 withdraw で
 * 消えても PostgREST は成功を返す）を、こちらだけが抱えたままだった。
 *
 * accept は「通常の participation write と全く同一の operation」であるという
 * AGENTS.md / decisions.md の決定を、コード上でも成立させる。ここで検証するのは
 * **canonical な write boundary を本当に通っているか**であり、race の処理そのもの
 * ではない（それは `participation.test.ts` の担当）。
 *
 * `authActionClient`（`@/lib/safe-action.ts`）が使う `createSupabaseServerClient`
 * を差し替えて認証済み扱いにし、`setParticipationChoice` を spy にする。
 */

const OCCURRENCE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mockSetParticipationChoice = vi.fn();
const mockRevalidatePath = vi.fn();
const supabaseStub = { auth: { getUser: vi.fn() } };

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

const { acceptInvitationAction } = await import("./invitations.js");

function signedIn() {
  supabaseStub.auth.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
}

describe("acceptInvitationAction", () => {
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
});
