import { err, ok } from "@stage-tracker/domain";
import { describe, expect, it } from "vitest";
import { classifyBlock1, classifyBlock2 } from "./read-state";

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

  it("maps permission-denied to unavailable, not error", () => {
    const state = classifyBlock1(
      err({ kind: "permission-denied" as const, message: "denied" }),
      (a: number[]) => a,
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "unavailable", message: "denied" });
  });

  it("maps failure to error", () => {
    const state = classifyBlock1(
      err({ kind: "failure" as const, message: "boom" }),
      (a: number[]) => a,
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "error", message: "boom" });
  });
});

describe("classifyBlock2", () => {
  it("is populated only once both independent reads succeed", () => {
    const state = classifyBlock2(
      ok(["a"]),
      ok(["b"]),
      (a, b) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "populated", data: ["a", "b"] });
  });

  it("surfaces the first read's failure without calling build", () => {
    let buildCalled = false;
    const state = classifyBlock2(
      err({ kind: "unauthenticated" as const, message: "no session" }),
      ok(["b"]),
      (a: string[], b: string[]) => {
        buildCalled = true;
        return [...a, ...b];
      },
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "unavailable", message: "no session" });
    expect(buildCalled).toBe(false);
  });

  it("surfaces the second read's failure independently of the first's success", () => {
    const state = classifyBlock2(
      ok(["a"]),
      err({ kind: "failure" as const, message: "boom" }),
      (a: string[], b: string[]) => [...a, ...b],
      (data) => data.length === 0,
    );
    expect(state).toEqual({ variant: "error", message: "boom" });
  });
});
