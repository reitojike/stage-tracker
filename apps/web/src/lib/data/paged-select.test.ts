import type { PostgrestError, PostgrestResponse } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { runPagedSupabaseSelect } from "./paged-select";

/**
 * `PostgrestResponse` を組み立てるヘルパー。実 HTTP は経由せず `queryPage`
 * を直接 mock する - `runPagedSupabaseSelect` 自体のページング loop 本体
 * （`Content-Range` パース等の supabase-js 側の挙動ではなく、この関数の
 * 「count に達するまで range を進める」ロジック）を検証する。
 */
function successPage<Row>(
  data: readonly Row[],
  count: number | null,
): PostgrestResponse<Row> {
  return {
    data: data as Row[],
    error: null,
    count,
    status: 200,
    statusText: "OK",
    success: true,
  } as PostgrestResponse<Row>;
}

/** `error` はテストが実際に触れるフィールド（`code`/`message`）だけを持つ
 * 最小限の値でよい - `classifyPostgrestError` はそれ以上を読まない。 */
function failurePage<Row>(
  error: Pick<PostgrestError, "message" | "code">,
): PostgrestResponse<Row> {
  return {
    data: null,
    error: error as PostgrestError,
    count: null,
    status: 500,
    statusText: "",
    success: false,
  } as PostgrestResponse<Row>;
}

describe("runPagedSupabaseSelect", () => {
  it("returns every row from a single page when count fits within it", async () => {
    const queryPage = vi.fn().mockResolvedValueOnce(successPage([1, 2, 3], 3));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result).toEqual({ ok: true, value: [1, 2, 3] });
    expect(queryPage).toHaveBeenCalledTimes(1);
    expect(queryPage).toHaveBeenCalledWith(0, 499);
  });

  /**
   * PostgREST の `api.max_rows`（既定 1000）による silent truncation を
   * 検出・克服できることの regression test（PR #402 review finding 1）。
   * 1 ページ目が `PAGE_SIZE`（500）ちょうどを返し、かつ報告 count がそれを
   * 上回る場合は、まだ全件読めていないと判断して2ページ目を要求する。
   */
  it("requests a second page when the first page is full and the reported count is larger", async () => {
    const firstPage = Array.from({ length: 500 }, (_, i) => i);
    const queryPage = vi
      .fn()
      .mockResolvedValueOnce(successPage(firstPage, 501))
      .mockResolvedValueOnce(successPage([500], 501));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(501);
    }
    expect(queryPage).toHaveBeenCalledTimes(2);
    expect(queryPage).toHaveBeenNthCalledWith(1, 0, 499);
    expect(queryPage).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it("stops early if a page comes back short even though more rows were expected (defensive, does not loop forever)", async () => {
    const queryPage = vi.fn().mockResolvedValueOnce(successPage([], 5));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result).toEqual({ ok: true, value: [] });
    expect(queryPage).toHaveBeenCalledTimes(1);
  });

  it("fails when a page reports an error", async () => {
    const queryPage = vi
      .fn()
      .mockResolvedValueOnce(
        failurePage<never>({ message: "boom", code: "XX000" }),
      );

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  it("fails (does not silently accept a partial result) when count is not reported", async () => {
    const queryPage = vi.fn().mockResolvedValueOnce(successPage([1, 2], null));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  it("fails when the query throws (network exception)", async () => {
    const queryPage = vi.fn().mockRejectedValueOnce(new Error("network down"));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
