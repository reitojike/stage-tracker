import { describe, expect, it } from "vitest";
import {
  ActionError,
  BASE_ACTION_ERROR_KINDS,
  type BaseActionErrorKind,
} from "./action-error";

describe("ActionError", () => {
  it("exposes the base error kinds vocabulary exactly once each", () => {
    expect(BASE_ACTION_ERROR_KINDS).toEqual([
      "unauthenticated",
      "not-found",
      "permission-denied",
      "validation",
      "failure",
    ]);
    expect(new Set(BASE_ACTION_ERROR_KINDS).size).toBe(
      BASE_ACTION_ERROR_KINDS.length,
    );
  });

  it("carries the given base kind and message", () => {
    const error = new ActionError("not-found", "occurrence not found");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ActionError");
    expect(error.kind).toBe("not-found");
    expect(error.message).toBe("occurrence not found");
  });

  it("accepts a feature-specific extra kind via the type parameter", () => {
    const error = new ActionError<"duplicate-occurrence">(
      "duplicate-occurrence",
      "an occurrence already starts at this instant",
    );

    const kind: BaseActionErrorKind | "duplicate-occurrence" = error.kind;
    expect(kind).toBe("duplicate-occurrence");
  });
});
