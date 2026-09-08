import { describe, expect, it } from "vitest";
import { resolvePreviewOrigin } from "./preview-origin";

const BRANCH = "stage-tracker-git-v2-m6e-reitojike.vercel.app";
const DEPLOYMENT = "stage-tracker-abc123-reitojike.vercel.app";

describe("resolvePreviewOrigin", () => {
  it("preview では branch URL を優先して origin を返す", () => {
    expect(resolvePreviewOrigin("preview", BRANCH, DEPLOYMENT)).toBe(
      `https://${BRANCH}/`,
    );
  });

  it("branch URL が無ければ deployment URL を使う", () => {
    expect(resolvePreviewOrigin("preview", undefined, DEPLOYMENT)).toBe(
      `https://${DEPLOYMENT}/`,
    );
  });

  // Production の redirect 先に Preview の値が混ざる経路も、その逆も作らない。
  it("production では undefined を返す（Supabase の Site URL に委ねる）", () => {
    expect(
      resolvePreviewOrigin("production", BRANCH, DEPLOYMENT),
    ).toBeUndefined();
  });

  it("local（VERCEL_ENV 未設定）でも undefined を返す", () => {
    expect(resolvePreviewOrigin(undefined, BRANCH, DEPLOYMENT)).toBeUndefined();
  });

  it("host 以外を含む値は受け付けない（任意 URL 構築の境界にしない）", () => {
    for (const bad of [
      "https://evil.test",
      "evil.test/callback",
      "evil.test?next=/",
      "evil.test#frag",
      "evil test",
      "",
      "   ",
      `${"a".repeat(254)}.test`,
    ]) {
      expect(resolvePreviewOrigin("preview", bad, undefined)).toBeUndefined();
    }
  });

  it("不正な branch URL は deployment URL へフォールバックする", () => {
    expect(
      resolvePreviewOrigin("preview", "https://evil.test", DEPLOYMENT),
    ).toBe(`https://${DEPLOYMENT}/`);
  });

  it("末尾スラッシュを落とさない（Supabase のワイルドカード一致のため）", () => {
    const origin = resolvePreviewOrigin("preview", BRANCH, undefined);
    expect(origin?.endsWith("/")).toBe(true);
  });
});
