import { describe, expect, it } from "vitest";
import { assertLocalApiUrl } from "./localSupabase";

/**
 * この suite は service-role key を使うため、接続先が local であることを
 * 「supabase status は local しか返さないはず」という前提に委ねない。
 * 検査が実際に発火することを固定する。
 */
describe("assertLocalApiUrl", () => {
  it("ローカルの API_URL は通す", () => {
    for (const url of [
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "http://[::1]:54321",
    ]) {
      expect(() => {
        assertLocalApiUrl(url);
      }).not.toThrow();
    }
  });

  it("リモートの API_URL は拒否する", () => {
    expect(() => {
      assertLocalApiUrl("https://sachzrublrsxmnpzjkzd.supabase.co");
    }).toThrow(/non-local Supabase/u);
  });

  it("localhost を含むだけのホスト名は通さない", () => {
    expect(() => {
      assertLocalApiUrl("https://localhost.evil.test");
    }).toThrow(/non-local Supabase/u);
  });

  it("解析できない値は拒否する", () => {
    expect(() => {
      assertLocalApiUrl("not a url");
    }).toThrow(/Unparsable API_URL/u);
  });
});
