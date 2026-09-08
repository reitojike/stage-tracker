import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyPostgrestLikeError } from "./postgrest-error";

/**
 * M6d review finding 1: `classifyPostgrestLikeError` はかつて SQLSTATE
 * `90002`（effectively-canceled）以外のすべての kind で `error.message`
 * （PostgREST/Postgres の生メッセージ）をそのまま `ActionError.message` へ
 * 転記しており、`@/lib/safe-action.ts` -> `result.serverError.message` 経由で
 * client（NewEventForm/AddOccurrenceForm/OccurrenceItem/EditEventForm）へ
 * 露出していた。ここでは各 SQLSTATE について、特徴的な生メッセージが
 * 返り値の `message` に一切含まれないこと、および `console.error` へ
 * server ログとして残ることを検証する。
 */

const SECRET = "secret internal detail";

function rawError(code: string): { code: string; message: string } {
  return { code, message: SECRET };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyPostgrestLikeError", () => {
  it("classifies 42501 as permission-denied without leaking the raw message", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const result = classifyPostgrestLikeError(rawError("42501"));
    expect(result.kind).toBe("permission-denied");
    expect(result.message).not.toContain(SECRET);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("classifies 23505 as duplicate-occurrence without leaking the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = classifyPostgrestLikeError(rawError("23505"));
    expect(result.kind).toBe("duplicate-occurrence");
    expect(result.message).not.toContain(SECRET);
  });

  it("classifies 90001 as delete-blocked without leaking the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = classifyPostgrestLikeError(rawError("90001"));
    expect(result.kind).toBe("delete-blocked");
    expect(result.message).not.toContain(SECRET);
  });

  it("classifies 90002 as validation with the fixed cancellation message", () => {
    const result = classifyPostgrestLikeError(rawError("90002"));
    expect(result.kind).toBe("validation");
    expect(result.message).toBe("この公演は中止されているため操作できません。");
    expect(result.message).not.toContain(SECRET);
  });

  it.each(["23502", "23503", "23514", "22007", "22008", "22P02", "22004"])(
    "classifies validation code %s as validation without leaking the raw message",
    (code) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = classifyPostgrestLikeError(rawError(code));
      expect(result.kind).toBe("validation");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("classifies an unknown code as failure without leaking the raw message", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const result = classifyPostgrestLikeError(rawError("99999"));
    expect(result.kind).toBe("failure");
    expect(result.message).not.toContain(SECRET);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
