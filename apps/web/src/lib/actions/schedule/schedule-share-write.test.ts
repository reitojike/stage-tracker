import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "@/test/msw/server";
import {
  personalScheduleEntryIdSchema,
  scheduleShareIdSchema,
} from "@stage-tracker/domain";
import type { Database } from "@/lib/data/database.types";
import {
  addScheduleShareByEmail,
  removeScheduleShare,
} from "./schedule-share-write";

const SUPABASE_URL = "https://example-project.supabase.test";
const REST_URL = `${SUPABASE_URL}/rest/v1`;

function createTestClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, "anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ENTRY_ID = personalScheduleEntryIdSchema.parse(
  "11111111-1111-4111-8111-111111111111",
);
const SHARE_ID = scheduleShareIdSchema.parse(
  "55555555-5555-4555-8555-555555555555",
);

afterEach(() => {
  server.resetHandlers();
});

describe("addScheduleShareByEmail", () => {
  it("resolves without throwing on a successful RPC call", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            id: SHARE_ID,
            schedule_entry_id: ENTRY_ID,
            shared_with_user_id: "22222222-2222-4222-8222-222222222222",
            created_at: "2026-01-01T00:00:00Z",
          },
          { status: 200 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "friend@example.test",
      ),
    ).resolves.toBeUndefined();
  });

  /**
   * `share_schedule_entry_by_email` の「対象 email が未登録アカウント」
   * 拒否は、product rule（「Authenticated-user targeting」節: sharing に
   * Invitation のような opacity 要件がないため owner へ知らせてよい）が
   * 開示を許可した唯一の classified な状態。`postgrest-error.ts`/
   * `resolveShareByEmailBusinessRuleMessage`（このファイル上部の doc
   * comment参照）が、この1件だけ RPC の生メッセージ（`error.message`）を
   * 見て固定の安全な日本語文言へ差し替える - 生メッセージ自体は
   * `ActionError.message` に一切現れない。
   */
  it("classifies an unregistered-recipient-email P0001 rejection as validation with a classified message (never the raw PostgREST message)", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "P0001",
            message: "recipient email is not a registered account",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "nobody@example.test",
      ),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "このメールアドレスは、Stage Trackerに登録されていません。",
    });
  });

  /**
   * PR #389 の migration 適用**後**の形。`share_schedule_entry_by_email` が
   * 「未登録 email」を custom SQLSTATE `90010` で返すようになる。
   *
   * 上の `P0001` のテストと**両方が通る**ことが、この PR を単独で deploy
   * して安全である根拠。現行 DB（`P0001`）でも切替後の DB（`90010`）でも
   * 同じ classified 文言になる。
   */
  it("classifies an unregistered-recipient-email 90010 rejection as validation with the classified message", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "90010",
            message: "recipient email is not a registered account",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "nobody@example.test",
      ),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "このメールアドレスは、Stage Trackerに登録されていません。",
    });
  });

  /**
   * 分類は `error.code` だけで行い、HTTP status には依存しない。
   *
   * PostgREST が custom SQLSTATE をどの status へ写像するかは PostgREST の
   * version と設定に依存し、この repository が固定できる契約ではない。
   * status が 500 で届いても分類が変わらないことを固定する - さもないと
   * PostgREST の写像が変わった日に、未登録 email が汎用 failure へ退行する。
   */
  it("classifies 90010 by SQLSTATE alone, regardless of the HTTP status PostgREST maps it to", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "90010",
            message: "recipient email is not a registered account",
            details: "",
            hint: "",
          },
          { status: 500 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "nobody@example.test",
      ),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "このメールアドレスは、Stage Trackerに登録されていません。",
    });
  });

  /**
   * 自己共有（`90011`）は `validation` のままだが、product rule が開示を
   * 許可しているのは「未登録 email」の一点だけなので、文言は generic な
   * 安全文言へ fail-closed する（`90010` と同じ扱いにはしない）。
   */
  it("classifies a self-share 90011 rejection as validation with the generic safe message", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "90011",
            message: "cannot share with yourself",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(createTestClient(), ENTRY_ID, "me@example.test"),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "入力内容をご確認のうえ、再度お試しください。",
    });
  });

  /**
   * 未登録 email 以外の P0001 業務ルール違反（自己共有・owner以外からの
   * 呼び出し等）はすべて同一の SQLSTATE で返り、`resolveShareByEmailBusinessRuleMessage`
   * が一致しないため generic な安全文言へ fail-closed する
   * （`postgrest-error.ts` の doc comment参照）。ここでは
   * message 文字列の中身で分岐せず（A8）、生メッセージが `ActionError`
   * へ一切転記されないことを検証する。
   */
  it("classifies any other P0001 business-rule rejection as validation with the generic safe message (never the raw PostgREST message)", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          {
            code: "P0001",
            message: "cannot share with yourself",
            details: "",
            hint: "",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(createTestClient(), ENTRY_ID, "me@example.test"),
    ).rejects.toMatchObject({
      kind: "validation",
      message: "入力内容をご確認のうえ、再度お試しください。",
    });
  });

  it("classifies a 401 as unauthenticated", async () => {
    server.use(
      http.post(`${REST_URL}/rpc/share_schedule_entry_by_email`, () =>
        HttpResponse.json(
          { message: "JWT expired", details: "", hint: "", code: "PGRST301" },
          { status: 401 },
        ),
      ),
    );

    await expect(
      addScheduleShareByEmail(
        createTestClient(),
        ENTRY_ID,
        "friend@example.test",
      ),
    ).rejects.toMatchObject({ kind: "unauthenticated" });
  });
});

describe("removeScheduleShare", () => {
  it("resolves when exactly one share row is deleted (owner-remove and self-leave share this same call)", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([{ id: SHARE_ID }], { status: 200 }),
      ),
    );

    await expect(
      removeScheduleShare(createTestClient(), ENTRY_ID, SHARE_ID),
    ).resolves.toBeUndefined();
  });

  it("classifies a 0-row delete as not-found", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    await expect(
      removeScheduleShare(createTestClient(), ENTRY_ID, SHARE_ID),
    ).rejects.toMatchObject({
      kind: "not-found",
    });
  });

  /**
   * finding 2 の回帰テスト: owner 解除の DELETE は `shareId` だけでなく
   * `entryId` も条件に持たなければならない。RLS は「caller が owner または
   * recipient である share」までしか絞らないため、mutation 自体が両方を
   * WHERE 句に持たないと、caller が owner である別 entry の shareId を
   * 渡した場合にも削除が成立してしまう（doc comment 参照）。ここでは
   * 実際に発行される DELETE request の query に両条件が乗ることを検証する
   * - MSW handler が模す PostgREST はサーバー側で絞り込みを行うため、
   * client がクエリを送っていなければこのテストは失敗する。
   */
  it("sends both schedule_entry_id and id as DELETE query filters", async () => {
    let capturedUrl: URL | undefined;
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, ({ request }) => {
        capturedUrl = new URL(request.url);
        return HttpResponse.json([{ id: SHARE_ID }], { status: 200 });
      }),
    );

    await removeScheduleShare(createTestClient(), ENTRY_ID, SHARE_ID);

    expect(capturedUrl?.searchParams.get("id")).toBe(`eq.${SHARE_ID}`);
    expect(capturedUrl?.searchParams.get("schedule_entry_id")).toBe(
      `eq.${ENTRY_ID}`,
    );
  });

  /**
   * 上と対称の否定側。MSW handler は実際の PostgREST の絞り込み挙動を
   * 忠実に再現する: query に `eq.` フィルタが**乗っていない**列は絞り込み
   * 対象外として全行通過させ、乗っている列だけ一致判定する（PostgREST の
   * 実際の意味論どおり）。この handler は `SHARE_ID` が実在は `ENTRY_ID` に
   * 属する行として振る舞う。
   *
   * DELETE に `schedule_entry_id` を条件として送らない実装（fix 前）だと、
   * caller が別 entry の `entryId`（`UNRELATED_ENTRY_ID`）を渡しても
   * `id=eq.SHARE_ID` にしか一致条件がないため削除が成立してしまう
   * （finding 2 が指摘した実害）。`schedule_entry_id` も条件に送る実装
   * （fix 後）では、`UNRELATED_ENTRY_ID` はこの行の実際の所属先と一致せず
   * 0 行になり `not-found` になる。
   */
  it("treats a mismatched entryId as a 0-row delete (not-found), not a successful delete of an unrelated share", async () => {
    server.use(
      http.delete(`${REST_URL}/personal_schedule_shares`, ({ request }) => {
        const url = new URL(request.url);
        const idFilter = url.searchParams.get("id");
        const entryFilter = url.searchParams.get("schedule_entry_id");
        const row = { id: SHARE_ID, entryId: ENTRY_ID };
        const matches =
          (idFilter === null || idFilter === `eq.${row.id}`) &&
          (entryFilter === null || entryFilter === `eq.${row.entryId}`);
        return HttpResponse.json(matches ? [{ id: row.id }] : [], {
          status: 200,
        });
      }),
    );

    const UNRELATED_ENTRY_ID = personalScheduleEntryIdSchema.parse(
      "77777777-7777-4777-8777-777777777777",
    );

    await expect(
      removeScheduleShare(createTestClient(), UNRELATED_ENTRY_ID, SHARE_ID),
    ).rejects.toMatchObject({
      kind: "not-found",
    });
  });
});
