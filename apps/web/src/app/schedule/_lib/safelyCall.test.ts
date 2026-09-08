import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/action-error";
import { safelyCall } from "./safelyCall";

describe("safelyCall", () => {
  it("returns ok:true with the resolved value on success", async () => {
    const result = await safelyCall(async () => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("converts a thrown ActionError into ok:false with its message (never rethrows)", async () => {
    const result = await safelyCall(async () => {
      throw new ActionError("permission-denied", "権限がありません。");
    });
    expect(result).toEqual({ ok: false, message: "権限がありません。" });
  });

  it("converts an unrecognized thrown value into a generic ok:false message", async () => {
    const result = await safelyCall(async () => {
      throw new Error("boom");
    });
    expect(result).toEqual({
      ok: false,
      message: "予期しないエラーが発生しました。",
    });
  });
});
