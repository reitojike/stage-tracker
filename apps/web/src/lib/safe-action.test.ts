import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { toActionErrorShape } from "@/lib/safe-action";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

describe("toActionErrorShape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves a base ActionError kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError("permission-denied", "権限がありません。"),
      ),
    ).toEqual({
      kind: "permission-denied",
      message: "権限がありません。",
    });
  });

  it("preserves the duplicate-occurrence feature kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError<"duplicate-occurrence">(
          "duplicate-occurrence",
          "同じ日時の公演回が既に登録されています。",
        ),
      ),
    ).toEqual({
      kind: "duplicate-occurrence",
      message: "同じ日時の公演回が既に登録されています。",
    });
  });

  it("preserves the delete-blocked feature kind and message", () => {
    expect(
      toActionErrorShape(
        new ActionError<"delete-blocked">(
          "delete-blocked",
          "関連する参加・招待があるため削除できません。",
        ),
      ),
    ).toEqual({
      kind: "delete-blocked",
      message: "関連する参加・招待があるため削除できません。",
    });
  });

  it("redacts an ordinary Error to the generic failure shape", () => {
    const error = new Error("private database detail");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(toActionErrorShape(error)).toEqual({
      kind: "failure",
      message: "予期しないエラーが発生しました。",
    });
    expect(consoleError).toHaveBeenCalledWith(error);
  });
});
