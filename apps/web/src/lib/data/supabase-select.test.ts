import {
  PostgrestError,
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@/test/msw/server";
import { classifyPostgrestError, runSupabaseSelect } from "./supabase-select";

function testPostgrestError(
  overrides: Partial<{ message: string; code: string }> = {},
) {
  return new PostgrestError({
    message: overrides.message ?? "x",
    details: "",
    hint: "",
    code: overrides.code ?? "",
  });
}

/**
 * `runSupabaseSelect`/`classifyPostgrestError` を、実際の
 * `@supabase/supabase-js` client + MSW でモックした PostgREST 応答を通して
 * 検証する（タスク指示: 「MSW で Supabase のレスポンスをモックし、権限
 * エラー・空結果・失敗を作り分ける」）。ハンドロールした stub ではなく
 * 実クライアントを使うのは、`@supabase/postgrest-js` 自身が
 * `data`/`error`/`status` をどう組み立てるかまで含めて検証するため。
 */
const SUPABASE_URL = "https://example-project.supabase.test";
const SUPABASE_ANON_KEY = "test-anon-key";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

describe("runSupabaseSelect", () => {
  it("classifies a successful 200 response with an empty array as an ok Result with 0 rows", async () => {
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result).toEqual({ ok: true, value: [] });
  });

  it("classifies a successful 200 response with rows as an ok Result carrying them", async () => {
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json([{ id: "1" }, { id: "2" }], { status: 200 }),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result).toEqual({ ok: true, value: [{ id: "1" }, { id: "2" }] });
  });

  it("classifies a 401 (missing/invalid session) as unauthenticated, not empty", async () => {
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unauthenticated");
    }
  });

  it("classifies a 403 as permission-denied, not empty", async () => {
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json(
          { message: "Forbidden", details: "", hint: "", code: "PGRST000" },
          { status: 403 },
        ),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });

  it("classifies a table-level-grant-denied 42501 as permission-denied even without a 401/403 status", async () => {
    // This is the exact SQLSTATE convention documented in
    // docs/v2/oracle-database.md §0: "42501 (insufficient_privilege):
    // 権限がない...". PostgREST typically also sets a 4xx status for this,
    // but this test asserts the *code* alone is a sufficient signal so a
    // permission failure is never miscategorized as a generic `failure`.
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json(
          {
            message: "permission denied for table widgets",
            details: "",
            hint: "",
            code: "42501",
          },
          { status: 400 },
        ),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("permission-denied");
    }
  });

  it("classifies an unrelated 500 as failure, not unavailable, without leaking the raw PostgREST message", async () => {
    // PR #381 review finding 2: the raw DB/PostgREST message ("internal
    // error" here stands in for real table/constraint-naming detail) must
    // never reach the caller - it is logged server-side only, and
    // `ReadError.message` is always one of the fixed, safe strings in
    // `./read-error.ts`.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // swallow the expected log for this test
    });
    server.use(
      http.get(`${REST_URL}/widgets`, () =>
        HttpResponse.json(
          {
            message: "internal error: relation widgets_secret_col violates x",
            details: "",
            hint: "",
            code: "XX000",
          },
          { status: 500 },
        ),
      ),
    );
    const client = createTestClient();

    const result = await runSupabaseSelect(client.from("widgets").select("*"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
      expect(result.error.message).not.toContain("widgets_secret_col");
    }
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("classifies a network-level failure (fetch rejects) as failure, without throwing", async () => {
    server.use(http.get(`${REST_URL}/widgets`, () => HttpResponse.error()));
    const client = createTestClient();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      // swallow the expected log for this test
    });

    // postgrest-js retries GET requests on network errors by default
    // (exponential backoff, up to 3 attempts) - disabled here since this
    // test targets this boundary's classification, not postgrest-js's own
    // retry behavior.
    const result = await runSupabaseSelect(
      client.from("widgets").select("*").retry(false),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }

    consoleError.mockRestore();
  });
});

describe("classifyPostgrestError", () => {
  it("treats status 401 as unauthenticated regardless of code", () => {
    expect(classifyPostgrestError(testPostgrestError(), 401).kind).toBe(
      "unauthenticated",
    );
  });

  it("treats status 403 as permission-denied regardless of code", () => {
    expect(classifyPostgrestError(testPostgrestError(), 403).kind).toBe(
      "permission-denied",
    );
  });

  it("treats code 42501 as permission-denied regardless of status", () => {
    expect(
      classifyPostgrestError(testPostgrestError({ code: "42501" }), 200).kind,
    ).toBe("permission-denied");
  });

  it("falls back to failure for anything else", () => {
    expect(
      classifyPostgrestError(testPostgrestError({ code: "23505" }), 409).kind,
    ).toBe("failure");
  });
});
