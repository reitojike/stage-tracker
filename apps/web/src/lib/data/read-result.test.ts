import { describe, expect, it } from "vitest";
import { err, ok } from "@stage-tracker/domain";
import {
  classifyListReadResult,
  classifyReadResult,
  toReadErrorVariant,
} from "./read-result";

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
 *
 * PR #381 review finding 2 以降、`unavailable`/`error` variant は
 * `message` を持たない（`./read-result.ts` の `ReadState` 定義参照）。
 * 生の PostgREST/network メッセージを screen まで運ばない設計は、この
 * 型そのものに `message` フィールドが無いことで保証される。
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
    expect(state).toEqual({ variant: "unavailable" });
  });

  it("classifies a permission-denied failure as unavailable, never empty", () => {
    const state = classifyListReadResult(
      err({ kind: "permission-denied", message: "insufficient_privilege" }),
    );
    expect(state).toEqual({ variant: "unavailable" });
  });

  it("classifies an unclassified failure as error, never empty", () => {
    const state = classifyListReadResult(
      err({ kind: "failure", message: "network down" }),
    );
    expect(state).toEqual({ variant: "error" });
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

/**
 * `classifyReadResult` is the single canonical classification primitive
 * (PR #381 review finding 3) - `classifyListReadResult` above and
 * `@/app/_lib/read-state.ts`'s `classifyBlock1`/`classifyBlock2Optional`/
 * `classifyMergedListBlock2` all build on this rather than reimplementing
 * the same 4-way split.
 */
describe("classifyReadResult", () => {
  it("never calls build/isEmpty for a failed Result", () => {
    let called = false;
    const state = classifyReadResult(
      err({ kind: "failure" as const, message: "boom" }),
      () => {
        called = true;
        return "unreachable";
      },
      () => {
        called = true;
        return true;
      },
    );

    expect(state).toEqual({ variant: "error" });
    expect(called).toBe(false);
  });

  it("classifies a transformed, non-array success shape as empty/populated via isEmpty", () => {
    const populated = classifyReadResult(
      ok([1, 2, 3]),
      (rows) => ({ count: rows.length }),
      (data) => data.count === 0,
    );
    expect(populated).toEqual({ variant: "populated", data: { count: 3 } });

    const empty = classifyReadResult(
      ok([] as number[]),
      (rows) => ({ count: rows.length }),
      (data) => data.count === 0,
    );
    expect(empty).toEqual({ variant: "empty" });
  });
});

describe("toReadErrorVariant", () => {
  it("maps unauthenticated/permission-denied to unavailable and failure to error", () => {
    expect(toReadErrorVariant("unauthenticated")).toBe("unavailable");
    expect(toReadErrorVariant("permission-denied")).toBe("unavailable");
    expect(toReadErrorVariant("failure")).toBe("error");
  });
});
