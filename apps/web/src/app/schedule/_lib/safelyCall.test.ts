import { describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import { safelyCall } from "./safelyCall";

describe("safelyCall", () => {
  it("returns ok:true with the resolved value on success", async () => {
    const result = await safelyCall(async () => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it("converts a thrown ActionError into ok:false without exposing its message (never rethrows)", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const thrown = new ActionError("permission-denied", "権限がありません。");

    const result = await safelyCall(async () => {
      throw thrown;
    });

    expect(result).toEqual({ ok: false });
    // The message is still logged server-side for forensics - it just never
    // reaches the returned `SafeCallResult` a screen could render.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), thrown);
    consoleErrorSpy.mockRestore();
  });

  it("converts an unrecognized thrown value into ok:false without exposing any message", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const result = await safelyCall(async () => {
      throw new Error("boom");
    });

    expect(result).toEqual({ ok: false });
    consoleErrorSpy.mockRestore();
  });
});
