import { PostgrestError, type PostgrestResponse } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  runKeysetSupabaseSelect,
  runPagedSupabaseSelect,
} from "./paged-select";

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
    data: [...data],
    error: null,
    count,
    status: 200,
    statusText: "OK",
    success: true,
  } satisfies PostgrestResponse<Row>;
}

/** `error` はテストが実際に触れるフィールド（`code`/`message`）だけを持つ
 * 最小限の値でよい - `classifyPostgrestError` はそれ以上を読まない。 */
function failurePage<Row>(
  error: Pick<PostgrestError, "message" | "code">,
): PostgrestResponse<Row> {
  return {
    data: null,
    error: new PostgrestError({
      message: error.message,
      code: error.code,
      details: "",
      hint: "",
    }),
    count: null,
    status: 500,
    statusText: "",
    success: false,
  } satisfies PostgrestResponse<Row>;
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

  it("fails closed if an empty page arrives before the exact count is reached", async () => {
    const queryPage = vi.fn().mockResolvedValueOnce(successPage([], 5));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
    expect(queryPage).toHaveBeenCalledTimes(1);
  });

  it("preserves every row across the page boundary without duplicates or omissions", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ id: index }));
    const queryPage = vi
      .fn()
      .mockResolvedValueOnce(successPage(rows.slice(0, 500), rows.length))
      .mockResolvedValueOnce(successPage(rows.slice(500), rows.length));

    const result = await runPagedSupabaseSelect(queryPage);

    expect(result).toEqual({ ok: true, value: rows });
    expect(queryPage).toHaveBeenNthCalledWith(1, 0, 499);
    expect(queryPage).toHaveBeenNthCalledWith(2, 500, 999);
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

describe("runKeysetSupabaseSelect", () => {
  type Row = { id: string };

  function keysetRows(rows: readonly Row[]) {
    return (cursor: string | null, limit: number) => {
      const remaining =
        cursor === null ? rows : rows.filter((row) => row.id > cursor);
      return Promise.resolve(
        successPage(remaining.slice(0, limit), remaining.length),
      );
    };
  }

  it("returns all 1001 rows through the final keyset page", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));

    const result = await runKeysetSupabaseSelect(keysetRows(rows));

    expect(result).toEqual({ ok: true, value: rows });
  });

  it("continues after a short page when exact count says rows remain", async () => {
    const queryPage = vi
      .fn()
      .mockResolvedValueOnce(successPage([{ id: "a" }], 3))
      .mockResolvedValueOnce(successPage([{ id: "b" }], 2))
      .mockResolvedValueOnce(successPage([{ id: "c" }], 1));

    const result = await runKeysetSupabaseSelect(queryPage);

    expect(result).toEqual({
      ok: true,
      value: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    expect(queryPage).toHaveBeenNthCalledWith(1, null, 500);
    expect(queryPage).toHaveBeenNthCalledWith(2, "a", 500);
    expect(queryPage).toHaveBeenNthCalledWith(3, "b", 500);
  });

  it("fails closed when a page cannot advance while rows remain", async () => {
    const queryPage = vi
      .fn()
      .mockResolvedValueOnce(successPage([{ id: "a" }], 2))
      .mockResolvedValueOnce(successPage([], 1));

    const result = await runKeysetSupabaseSelect(queryPage);

    expect(result.ok).toBe(false);
  });

  it("does not duplicate or omit rows when a row before the cursor is deleted", async () => {
    const originalRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    let page = 0;
    const queryPage = (cursor: string | null, limit: number) => {
      page += 1;
      const rows = page === 2 ? originalRows.slice(1) : originalRows;
      const remaining =
        cursor === null ? rows : rows.filter((row) => row.id > cursor);
      return Promise.resolve(
        successPage(remaining.slice(0, limit), remaining.length),
      );
    };

    const result = await runKeysetSupabaseSelect(queryPage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1001);
      expect(new Set(result.value.map((row) => row.id)).size).toBe(1001);
      expect(result.value.at(-1)?.id).toBe(originalRows.at(-1)?.id);
    }
  });

  it("does not repeat existing rows when a row is inserted behind the cursor", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    let page = 0;
    const queryPage = (cursor: string | null, limit: number) => {
      page += 1;
      const currentRows =
        page === 2
          ? [{ id: "00000000-0000-4000-8000-000000000000" }, ...rows]
          : rows;
      const remaining =
        cursor === null
          ? currentRows
          : currentRows.filter((row) => row.id > cursor);
      return Promise.resolve(
        successPage(remaining.slice(0, limit), remaining.length),
      );
    };

    const result = await runKeysetSupabaseSelect(queryPage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1001);
      expect(new Set(result.value.map((row) => row.id)).size).toBe(1001);
    }
  });

  it("includes a row inserted ahead of the cursor at most once", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    const inserted = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" };
    let page = 0;
    const queryPage = (cursor: string | null, limit: number) => {
      page += 1;
      const currentRows = page >= 2 ? [...rows, inserted] : rows;
      const remaining =
        cursor === null
          ? currentRows
          : currentRows.filter((row) => row.id > cursor);
      return Promise.resolve(
        successPage(remaining.slice(0, limit), remaining.length),
      );
    };

    const result = await runKeysetSupabaseSelect(queryPage);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1002);
      expect(new Set(result.value.map((row) => row.id)).size).toBe(1002);
      expect(result.value.filter((row) => row.id === inserted.id)).toHaveLength(
        1,
      );
      expect(result.value.slice(0, 1001)).toEqual(rows);
    }
  });
});
