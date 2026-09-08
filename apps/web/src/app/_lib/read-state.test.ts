import { err, ok } from "@stage-tracker/domain";
import { describe, expect, it } from "vitest";
import {
  classifyBlock1,
  classifyBlock2Optional,
  classifyMergedListBlock2,
} from "./read-state";

describe("classifyBlock1", () => {
  it("is populated when the read succeeds with non-empty built data", () => {
    const state = classifyBlock1(
      ok([1, 2, 3]),
      (a) => a.map((n) => n * 2),
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "populated", data: [2, 4, 6] });
  });

  it("is empty when the read succeeds but the built data is empty", () => {
    const state = classifyBlock1(
      ok([] as number[]),
      (a) => a,
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "empty" });
  });

  it("maps permission-denied to unavailable, not error, without a message field", () => {
    const state = classifyBlock1(
      err({ kind: "permission-denied" as const, message: "denied" }),
      (a: number[]) => a,
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "unavailable" });
  });

  it("maps failure to error, without a message field", () => {
    const state = classifyBlock1(
      err({ kind: "failure" as const, message: "boom" }),
      (a: number[]) => a,
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "error" });
  });
});

/**
 * `classifyBlock2Optional` is the fix for PR #381 review finding 1's
 * "申し込み期限" example: a required (shared catalog) read and an optional
 * (personal state) read of the *same* entities. Its whole point is that the
 * optional read's failure must never hide the required read's data - and
 * (PR #381 P4 follow-up review finding 2, this Task) must never be silently
 * indistinguishable from the optional read genuinely having 0 rows: the
 * `optional` field on the returned `OptionalPartBlockState` is the type-level
 * guard for that, always present and always reflecting the optional read's
 * real `PartState`, independent of what `block` ends up looking like.
 */
describe("classifyBlock2Optional", () => {
  it("is populated from both, with optional reported ok, when both succeed", () => {
    const state = classifyBlock2Optional(
      ok(["opportunity-1"]),
      ok(["planned"]),
      [] as string[],
      (opportunities, states) => [...opportunities, ...states],
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      block: { variant: "populated", data: ["opportunity-1", "planned"] },
      optional: { ok: true },
    });
  });

  it("fails the whole block when the required read fails, regardless of the optional read, but still reports the optional read's own status", () => {
    const state = classifyBlock2Optional(
      err({ kind: "permission-denied" as const, message: "denied" }),
      ok(["planned"]),
      [] as string[],
      (opportunities: string[], states: string[]) => [
        ...opportunities,
        ...states,
      ],
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      block: { variant: "unavailable" },
      optional: { ok: true },
    });
  });

  it("degrades block's data to the fallback (still populated from the required read) when only the optional read fails - never hides the required data - and reports the optional read as failed rather than as empty", () => {
    const state = classifyBlock2Optional(
      ok(["opportunity-1", "opportunity-2"]),
      err({ kind: "failure" as const, message: "boom" }),
      [] as string[],
      (opportunities, states) => opportunities.map((o) => ({ o, states })),
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      block: {
        variant: "populated",
        data: [
          { o: "opportunity-1", states: [] },
          { o: "opportunity-2", states: [] },
        ],
      },
      optional: { ok: false, variant: "error" },
    });
    // The block's fallback-shaped data alone cannot distinguish "optional
    // succeeded with 0 rows" from "optional failed" (both produce `states:
    // []` above) - a caller MUST consult `optional` separately to tell them
    // apart. This is the exact type-level guard PR #381 P4 follow-up
    // demands: there is no `[]` value anywhere that says "the read failed".
    expect(state.optional.ok).toBe(false);
  });

  it("is empty when the required read succeeds with 0 rows, and still reports the optional read's failure separately rather than losing it", () => {
    const state = classifyBlock2Optional(
      ok([] as string[]),
      err({ kind: "failure" as const, message: "boom" }),
      [] as string[],
      (opportunities, states) => [...opportunities, ...states],
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      block: { variant: "empty" },
      optional: { ok: false, variant: "error" },
    });
  });
});

/**
 * `classifyMergedListBlock2` is the fix for PR #381 review finding 1's home
 * "直近の予定" example (`listMyParticipations` + `listVisiblePersonalSchedule`
 * merged into one chronological list) and for the misnamed
 * `home-loader.test.ts` test the review flagged: unlike the old
 * `classifyBlock2` this replaces, a single failed read must not empty out
 * the whole block when the other read still has data.
 *
 * PR #381 P4 follow-up review finding 1 (this Task): a single failed read
 * must also not be silently reported as `"empty"` merely because the
 * *surviving* read happens to have 0 rows of its own - that is still a real,
 * unresolved failure, not confirmed emptiness. `classifyMergedListBlock2`
 * reports that combination as `"partial"` (carrying both reads' `PartState`s
 * and whatever data the surviving read produced), never `"empty"`.
 */
describe("classifyMergedListBlock2", () => {
  it("is populated from both lists merged when both succeed", () => {
    const state = classifyMergedListBlock2(
      ok(["a"]),
      ok(["b"]),
      (a, b) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "populated", data: ["a", "b"] });
  });

  it("reports partial (not populated/empty) with the surviving read's data when the first read fails alone", () => {
    let buildCalled = false;
    const state = classifyMergedListBlock2(
      err({ kind: "unauthenticated" as const, message: "no session" }),
      ok(["b"]),
      (a: readonly string[], b: readonly string[]) => {
        buildCalled = true;
        return [...a, ...b];
      },
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      variant: "partial",
      data: ["b"],
      a: { ok: false, variant: "unavailable" },
      b: { ok: true },
    });
    expect(buildCalled).toBe(true);
  });

  it("reports partial (not populated/empty) with the surviving read's data when the second read fails alone", () => {
    const state = classifyMergedListBlock2(
      ok(["a"]),
      err({ kind: "failure" as const, message: "boom" }),
      (a: readonly string[], b: readonly string[]) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      variant: "partial",
      data: ["a"],
      a: { ok: true },
      b: { ok: false, variant: "error" },
    });
  });

  it("is empty (not a failure) when both reads succeed with 0 rows", () => {
    const state = classifyMergedListBlock2(
      ok([] as string[]),
      ok([] as string[]),
      (a, b) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "empty" });
  });

  it("is partial, never empty, when the surviving read succeeds with 0 rows and the other read fails - a real failure must not disappear into the same panel as a confirmed 0-row empty state", () => {
    const state = classifyMergedListBlock2(
      ok([] as string[]),
      err({ kind: "failure" as const, message: "boom" }),
      (a, b) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state.variant).not.toBe("empty");
    expect(state).toEqual({
      variant: "partial",
      data: [],
      a: { ok: true },
      b: { ok: false, variant: "error" },
    });
  });

  it("reports a failure only when both reads fail", () => {
    const state = classifyMergedListBlock2(
      err({ kind: "permission-denied" as const, message: "denied" }),
      err({ kind: "failure" as const, message: "boom" }),
      (a: readonly string[], b: readonly string[]) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "unavailable" });
  });
});
