import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { occurrenceIdSchema, userIdSchema } from "@stage-tracker/domain";
import { server } from "@/test/msw/server";
import { setParticipationChoice } from "./participation";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

const occurrenceId = occurrenceIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const userId = userIdSchema.parse("22222222-2222-4222-8222-222222222222");

function createTestClient(): SupabaseClient {
  return createClient(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

afterEach(() => {
  server.resetHandlers();
});

describe("setParticipationChoice", () => {
  it("withdraw: DELETEs the caller's own row and never SELECTs first", async () => {
    server.use(
      http.delete(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(null, { status: 204 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "withdraw",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("create: INSERTs when no existing row is found (never uses upsert)", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(null, { status: 201 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("update: PATCHes only `status` on the existing row when one is found", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ id: "row-1", status: "considering" }], {
          status: 200,
        }),
      ),
      http.patch(
        `${REST_URL}/occurrence_participations`,
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body).toEqual({ status: "attending" });
          // `.select("id")` を付けているため、実際に更新された行を含む
          // 配列（PostgREST の `return=representation`）で応答する。
          return HttpResponse.json([{ id: "row-1" }], { status: 200 });
        },
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("0 行更新（対象行が UPDATE 前に消えていた）を成功扱いにせず、INSERT へ fall through する", async () => {
    // 指摘2のレース: SELECT で見つけた既存行が、この UPDATE の実行前に
    // 別の呼び出し（例: 並行 withdraw の DELETE）によって既に消えている。
    // PostgREST 自体はエラーを返さない（0 行更新のまま成功応答）ため、
    // `.select("id").maybeSingle()` で「0 行だった」ことを確認できて
    // 初めて区別できる。この場合は成功扱いにせず、INSERT で新しい行を
    // 作る経路へ fall through しなければならない。
    let patchCallCount = 0;
    let insertCalled = false;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ id: "row-1", status: "considering" }], {
          status: 200,
        }),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () => {
        patchCallCount += 1;
        // 対象行が既に消えているので PostgREST は空配列（0 行）で応答する。
        return HttpResponse.json([], { status: 200 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () => {
        insertCalled = true;
        return HttpResponse.json(null, { status: 201 });
      }),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(patchCallCount).toBe(1);
    expect(insertCalled).toBe(true);
  });

  it("is a no-op (no write) when the existing row already has the requested status", async () => {
    let writeAttempted = false;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([{ id: "row-1", status: "attending" }], {
          status: 200,
        }),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () => {
        writeAttempted = true;
        return HttpResponse.json(null, { status: 204 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () => {
        writeAttempted = true;
        return HttpResponse.json(null, { status: 201 });
      }),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(writeAttempted).toBe(false);
  });

  it("classifies a 90002 (effectively-canceled) rejection via SQLSTATE, not message matching", async () => {
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "some unrelated wording that must not be pattern-matched",
            details: "",
            hint: "",
            code: "90002",
          },
          { status: 400 },
        ),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "considering",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("occurrence-canceled");
    }
  });

  it("falls back to UPDATE when a concurrent INSERT races and loses (23505)", async () => {
    let selectCallCount = 0;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () => {
        selectCallCount += 1;
        // First select (pre-insert check): no row yet. Second select
        // (post-conflict refetch): the concurrent writer's row now exists.
        if (selectCallCount === 1) {
          return HttpResponse.json([], { status: 200 });
        }
        return HttpResponse.json([{ id: "raced-row" }], { status: 200 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "duplicate key value violates unique constraint",
            details: "",
            hint: "",
            code: "23505",
          },
          { status: 409 },
        ),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () =>
        // `.select("id")` を付けているため、実際に更新された行を含む配列
        // （PostgREST の `return=representation`）で応答する。
        HttpResponse.json([{ id: "raced-row" }], { status: 200 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("23505 後の refetch -> UPDATE も 0 行なら成功扱いにせず failure を返す（二重レース）", async () => {
    // 指摘2で挙げられたもう一方のレース窓: INSERT が 23505 で負けて refetch
    // した行を UPDATE しようとした時点で、その行がさらに別の呼び出しに
    // よって削除されている（二重レース）。ここまで来ると「行が無いなら
    // INSERT」という fallback を安全に繰り返せる保証はなく、`成功扱いに
    // しない` ことが要点なので、opaque な failure を返す。
    let selectCallCount = 0;
    server.use(
      http.get(`${REST_URL}/occurrence_participations`, () => {
        selectCallCount += 1;
        if (selectCallCount === 1) {
          return HttpResponse.json([], { status: 200 });
        }
        return HttpResponse.json([{ id: "raced-row" }], { status: 200 });
      }),
      http.post(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          {
            message: "duplicate key value violates unique constraint",
            details: "",
            hint: "",
            code: "23505",
          },
          { status: 409 },
        ),
      ),
      http.patch(`${REST_URL}/occurrence_participations`, () =>
        // refetch した行も既に消えている: 0 行更新。
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "attending",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });

  it("classifies an unrelated failure as the generic `failure` kind", async () => {
    server.use(
      http.delete(`${REST_URL}/occurrence_participations`, () =>
        HttpResponse.json(
          { message: "internal error", details: "", hint: "", code: "XX000" },
          { status: 500 },
        ),
      ),
    );

    const result = await setParticipationChoice(createTestClient(), {
      occurrenceId,
      userId,
      choice: "withdraw",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
    }
  });
});
