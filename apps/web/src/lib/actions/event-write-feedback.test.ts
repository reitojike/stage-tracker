import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/action-error";
import {
  throwEventCancellationError,
  throwEventCancellationPermissionDenied,
  throwEventDeleteError,
  throwEventWriteError,
  throwEventWritePermissionDenied,
  type EventCancellationOperation,
  type EventDeleteOperation,
  type EventWriteOperation,
} from "./event-write-feedback";
import type { RawPostgrestLikeError } from "./postgrest-error";

/**
 * M8 journey 比較（`docs/v2/m8-journey-comparison.md`）で確定した分類2の
 * 不具合修正: v2 は Event write/delete/cancellation の全 operation を
 * `classifyPostgrestLikeError` 経由の単一の汎用メッセージへ collapse して
 * いた。legacy の `eventWriteFeedback.ts` は operation ごとに異なる文言を
 * 返す（`docs/v2/oracle-domain.md:576-580`）。ここでは、各 error family に
 * ついて operation ごとに文言が実際に異なること（silent collapse への
 * regression guard）と、生の PostgREST message が client 向け message へ
 * 漏れないことを検証する。
 */

const SECRET = "secret internal detail";

function rawError(code: string): RawPostgrestLikeError {
  return { code, message: SECRET };
}

function catchActionError<ExtraKind extends string = never>(
  fn: () => never,
): ActionError<ExtraKind> {
  try {
    fn();
  } catch (error) {
    if (error instanceof ActionError) {
      return error as ActionError<ExtraKind>;
    }
    throw error;
  }
  throw new Error("expected fn to throw");
}

afterEach(() => {
  vi.restoreAllMocks();
});

const WRITE_OPERATIONS: readonly EventWriteOperation[] = [
  "create-event",
  "update-event",
  "add-occurrence",
  "update-occurrence",
];

const DELETE_OPERATIONS: readonly EventDeleteOperation[] = [
  "delete-event",
  "delete-occurrence",
];

const CANCELLATION_OPERATIONS: readonly EventCancellationOperation[] = [
  "cancel-event",
  "uncancel-event",
  "cancel-occurrence",
  "uncancel-occurrence",
];

describe("throwEventWriteError", () => {
  it.each(WRITE_OPERATIONS)(
    "classifies 42501 as permission-denied for %s without leaking the raw message",
    (operation) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = catchActionError(() =>
        throwEventWriteError(operation, rawError("42501")),
      );
      expect(result.kind).toBe("permission-denied");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("gives each write operation a distinct permission-denied message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const messages = WRITE_OPERATIONS.map(
      (operation) =>
        catchActionError(() =>
          throwEventWriteError(operation, rawError("42501")),
        ).message,
    );
    expect(new Set(messages).size).toBe(WRITE_OPERATIONS.length);
  });

  it("classifies 23505 as duplicate-occurrence regardless of operation", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = catchActionError(() =>
      throwEventWriteError("add-occurrence", rawError("23505")),
    );
    expect(result.kind).toBe("duplicate-occurrence");
    expect(result.message).not.toContain(SECRET);
  });

  it("classifies 90002 as validation with the fixed cancellation message", () => {
    const result = catchActionError(() =>
      throwEventWriteError("update-occurrence", rawError("90002")),
    );
    expect(result.kind).toBe("validation");
    expect(result.message).toContain("中止");
    expect(result.message).not.toContain(SECRET);
  });

  it.each(["23502", "23503", "23514", "22007", "22008", "22P02", "22004"])(
    "classifies validation code %s as validation without leaking the raw message",
    (code) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = catchActionError(() =>
        throwEventWriteError("create-event", rawError(code)),
      );
      expect(result.kind).toBe("validation");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("classifies an unknown code as failure without leaking the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = catchActionError(() =>
      throwEventWriteError("create-event", rawError("99999")),
    );
    expect(result.kind).toBe("failure");
    expect(result.message).not.toContain(SECRET);
  });
});

describe("throwEventWritePermissionDenied", () => {
  it("gives each write operation a distinct permission-denied message", () => {
    const results = WRITE_OPERATIONS.map((operation) =>
      catchActionError(() => throwEventWritePermissionDenied(operation)),
    );
    for (const result of results) {
      expect(result.kind).toBe("permission-denied");
    }
    const messages = results.map((result) => result.message);
    expect(new Set(messages).size).toBe(WRITE_OPERATIONS.length);
  });
});

describe("throwEventDeleteError", () => {
  it.each(DELETE_OPERATIONS)(
    "classifies 42501 as permission-denied for %s without leaking the raw message",
    (operation) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = catchActionError(() =>
        throwEventDeleteError(operation, rawError("42501")),
      );
      expect(result.kind).toBe("permission-denied");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("gives each delete operation a distinct permission-denied message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const messages = DELETE_OPERATIONS.map(
      (operation) =>
        catchActionError(() =>
          throwEventDeleteError(operation, rawError("42501")),
        ).message,
    );
    expect(new Set(messages).size).toBe(DELETE_OPERATIONS.length);
  });

  it.each(DELETE_OPERATIONS)(
    "classifies 90001 as delete-blocked for %s without leaking the raw message",
    (operation) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = catchActionError(() =>
        throwEventDeleteError(operation, rawError("90001")),
      );
      expect(result.kind).toBe("delete-blocked");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("gives each delete operation a distinct delete-blocked message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const messages = DELETE_OPERATIONS.map(
      (operation) =>
        catchActionError(() =>
          throwEventDeleteError(operation, rawError("90001")),
        ).message,
    );
    expect(new Set(messages).size).toBe(DELETE_OPERATIONS.length);
  });

  it("classifies an unknown code as failure without leaking the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = catchActionError(() =>
      throwEventDeleteError("delete-event", rawError("99999")),
    );
    expect(result.kind).toBe("failure");
    expect(result.message).not.toContain(SECRET);
  });
});

describe("throwEventCancellationError / throwEventCancellationPermissionDenied", () => {
  it.each(CANCELLATION_OPERATIONS)(
    "classifies 42501 as permission-denied for %s without leaking the raw message",
    (operation) => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const result = catchActionError(() =>
        throwEventCancellationError(operation, rawError("42501")),
      );
      expect(result.kind).toBe("permission-denied");
      expect(result.message).not.toContain(SECRET);
    },
  );

  it("gives each cancellation operation a distinct permission-denied message via both entry points", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const viaError = CANCELLATION_OPERATIONS.map(
      (operation) =>
        catchActionError(() =>
          throwEventCancellationError(operation, rawError("42501")),
        ).message,
    );
    const viaDirect = CANCELLATION_OPERATIONS.map(
      (operation) =>
        catchActionError(() =>
          throwEventCancellationPermissionDenied(operation),
        ).message,
    );
    expect(new Set(viaError).size).toBe(CANCELLATION_OPERATIONS.length);
    expect(viaDirect).toEqual(viaError);
  });

  it("classifies an unknown code as failure without leaking the raw message", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = catchActionError(() =>
      throwEventCancellationError("cancel-event", rawError("99999")),
    );
    expect(result.kind).toBe("failure");
    expect(result.message).not.toContain(SECRET);
  });
});
