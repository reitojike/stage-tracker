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
 * optional read's failure must never hide the required read's data.
 */
describe("classifyBlock2Optional", () => {
  it("is populated from both when both succeed", () => {
    const state = classifyBlock2Optional(
      ok(["opportunity-1"]),
      ok(["planned"]),
      [] as string[],
      (opportunities, states) => [...opportunities, ...states],
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      variant: "populated",
      data: ["opportunity-1", "planned"],
    });
  });

  it("fails the whole block when the required read fails, regardless of the optional read", () => {
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
    expect(state).toEqual({ variant: "unavailable" });
  });

  it("degrades to the fallback (still populated from the required read) when only the optional read fails - never hides the required data", () => {
    const state = classifyBlock2Optional(
      ok(["opportunity-1", "opportunity-2"]),
      err({ kind: "failure" as const, message: "boom" }),
      [] as string[],
      (opportunities, states) => opportunities.map((o) => ({ o, states })),
      (data) => data.length === 0,
    );
    expect(state).toEqual({
      variant: "populated",
      data: [
        { o: "opportunity-1", states: [] },
        { o: "opportunity-2", states: [] },
      ],
    });
  });

  it("is empty when the required read succeeds with 0 rows, even if the optional read also fails", () => {
    const state = classifyBlock2Optional(
      ok([] as string[]),
      err({ kind: "failure" as const, message: "boom" }),
      [] as string[],
      (opportunities, states) => [...opportunities, ...states],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "empty" });
  });
});

/**
 * `classifyMergedListBlock2` is the fix for PR #381 review finding 1's home
 * "直近の予定" example (`listMyParticipations` + `listVisiblePersonalSchedule`
 * merged into one chronological list) and for the misnamed
 * `home-loader.test.ts` test the review flagged: unlike the old
 * `classifyBlock2` this replaces, a single failed read must not empty out
 * the whole block when the other read still has data.
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

  it("stays populated from the surviving read when the first read fails alone", () => {
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
    expect(state).toEqual({ variant: "populated", data: ["b"] });
    expect(buildCalled).toBe(true);
  });

  it("stays populated from the surviving read when the second read fails alone", () => {
    const state = classifyMergedListBlock2(
      ok(["a"]),
      err({ kind: "failure" as const, message: "boom" }),
      (a: readonly string[], b: readonly string[]) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "populated", data: ["a"] });
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

  it("is empty (not a failure) when the surviving read succeeds with 0 rows and the other fails", () => {
    const state = classifyMergedListBlock2(
      ok([] as string[]),
      err({ kind: "failure" as const, message: "boom" }),
      (a, b) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "empty" });
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
