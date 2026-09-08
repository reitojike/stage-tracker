import { describe, expect, it } from "vitest";
import { readError } from "./read-error";

/**
 * PR #381 review finding 2: `readError()` no longer accepts a `message`
 * parameter at all (only `kind`) - the raw PostgREST/network/mapping detail
 * that used to flow straight into `ReadError.message` (and from there,
 * straight into `StatePanel`'s `description`) has nowhere left to go. This
 * is enforced by the function's own type signature (`readError(kind:
 * ReadErrorKind): ReadError`), not by caller discipline - a call site
 * cannot pass a second argument, so it cannot smuggle a raw string through
 * even by accident.
 *
 * `message` is always one of a small, fixed, hand-authored Japanese string
 * per `kind` - safe to exist even though production code no longer routes
 * it to any `StatePanel` (`@/app/_lib/read-state.ts`'s `ReadState`/
 * `BlockState` deliberately have no `message` field at all; screens author
 * their own copy per `variant`).
 */
describe("readError", () => {
  it("derives a fixed, non-empty message from kind alone for every ReadErrorKind", () => {
    expect(readError("unauthenticated")).toEqual({
      kind: "unauthenticated",
      message: expect.any(String),
    });
    expect(readError("permission-denied")).toEqual({
      kind: "permission-denied",
      message: expect.any(String),
    });
    expect(readError("failure")).toEqual({
      kind: "failure",
      message: expect.any(String),
    });
  });

  it("returns a distinct message per kind (never the same generic string for all 3)", () => {
    const messages = new Set(
      (["unauthenticated", "permission-denied", "failure"] as const).map(
        (kind) => readError(kind).message,
      ),
    );
    expect(messages.size).toBe(3);
  });

  it("is deterministic - the same kind always produces the same message", () => {
    expect(readError("failure").message).toBe(readError("failure").message);
  });
});
