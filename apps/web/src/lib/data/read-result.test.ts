import { describe, expect, it } from "vitest";
import { err, ok } from "@stage-tracker/domain";
import { classifyListReadResult } from "./read-result";

/**
 * このタスクで最も重要なテスト（タスク指示の「受け入れ条件」節）:
 * `docs/v2/decisions.md`「M6 が負う責任」の3状態分類が正しいこと。
 *
 * ```
 * fetch 成功 + 0 行   -> empty
 * fetch 失敗           -> error
 * 権限が無い / 見えない -> unavailable
 * ```
 *
 * 特に、fetch が失敗した場合は行数に関わらず絶対に `empty` にならない
 * ことを確認する（RLS の unavailable が empty へ化けることを防ぐのが
 * この関数の中心的責務）。
 */
describe("classifyListReadResult", () => {
  it("classifies a successful fetch with 0 rows as empty", () => {
    const state = classifyListReadResult(ok([]));
    expect(state).toEqual({ variant: "empty" });
  });

  it("classifies a successful fetch with rows as populated, carrying the data", () => {
    const state = classifyListReadResult(ok([1, 2, 3]));
    expect(state).toEqual({ variant: "populated", data: [1, 2, 3] });
  });

  it("classifies an unauthenticated failure as unavailable, never empty", () => {
    const state = classifyListReadResult(
      err({ kind: "unauthenticated", message: "no session" }),
    );
    expect(state).toEqual({ variant: "unavailable", message: "no session" });
  });

  it("classifies a permission-denied failure as unavailable, never empty", () => {
    const state = classifyListReadResult(
      err({ kind: "permission-denied", message: "insufficient_privilege" }),
    );
    expect(state).toEqual({
      variant: "unavailable",
      message: "insufficient_privilege",
    });
  });

  it("classifies an unclassified failure as error, never empty", () => {
    const state = classifyListReadResult(
      err({ kind: "failure", message: "network down" }),
    );
    expect(state).toEqual({ variant: "error", message: "network down" });
  });

  it("never returns empty for a failed Result, regardless of an (impossible) 0-length hint", () => {
    // A failed Result carries no `value` at all - this test documents the
    // invariant structurally: `!result.ok` is checked first and always
    // short-circuits before any row-count logic runs, so there is no code
    // path that could accidentally read `.length` off a failure and land
    // on `empty`.
    const failureKinds = [
      "unauthenticated",
      "permission-denied",
      "failure",
    ] as const;
    for (const kind of failureKinds) {
      const state = classifyListReadResult(err({ kind, message: "x" }));
      expect(state.variant).not.toBe("empty");
    }
  });
});
