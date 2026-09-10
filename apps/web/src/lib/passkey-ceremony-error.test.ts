import { describe, expect, it } from "vitest";
import {
  classifyPasskeyCeremonyError,
  resolveRegisterPasskeyFeedback,
  resolveSignInPasskeyFeedback,
} from "./passkey-ceremony-error";

describe("classifyPasskeyCeremonyError", () => {
  it("classifies ERROR_CEREMONY_ABORTED as cancelled", () => {
    expect(
      classifyPasskeyCeremonyError({
        message: "aborted",
        code: "ERROR_CEREMONY_ABORTED",
      }),
    ).toBe("cancelled");
  });

  it("classifies unsupported-authenticator codes as unsupported", () => {
    expect(
      classifyPasskeyCeremonyError({
        message: "unsupported",
        code: "ERROR_INVALID_DOMAIN",
      }),
    ).toBe("unsupported");
  });

  it("classifies webauthn_credential_exists as duplicate", () => {
    expect(
      classifyPasskeyCeremonyError({
        message: "exists",
        code: "webauthn_credential_exists",
      }),
    ).toBe("duplicate");
  });

  it("classifies too_many_passkeys as too-many", () => {
    expect(
      classifyPasskeyCeremonyError({
        message: "too many",
        code: "too_many_passkeys",
      }),
    ).toBe("too-many");
  });

  it("classifies an unknown or missing code as failure", () => {
    expect(classifyPasskeyCeremonyError({ message: "network error" })).toBe(
      "failure",
    );
    expect(
      classifyPasskeyCeremonyError({
        message: "something else",
        code: "SOME_UNKNOWN_CODE",
      }),
    ).toBe("failure");
  });
});

describe("resolveRegisterPasskeyFeedback", () => {
  it("returns a distinct title for every kind (no silent collapse to a single generic message)", () => {
    // M8 journey 比較（docs/v2/m8-journey-comparison.md）で確定した分類2の
    // regression test: oracle-routes-ui.md:245 が要求する「エラー種別分類
    // →パネル表示」を満たすには、5種類すべてが異なる文言を返す必要がある。
    const kinds = [
      "cancelled",
      "unsupported",
      "duplicate",
      "too-many",
      "failure",
    ] as const;
    const titles = kinds.map(
      (kind) => resolveRegisterPasskeyFeedback(kind).title,
    );
    expect(new Set(titles).size).toBe(kinds.length);
  });

  it("gives the failure kind a generic retry message", () => {
    expect(resolveRegisterPasskeyFeedback("failure")).toEqual({
      title: "Passkeyを登録できませんでした",
      description: "通信状況を確認し、もう一度お試しください。",
    });
  });
});

describe("resolveSignInPasskeyFeedback", () => {
  // Issue #406（M8 journey 比較で確定した分類2の regression test）:
  // oracle-routes-ui.md:49「サインイン（Passkey優先＋Magic Linkフォール
  // バック）」を満たすには、失敗時に単一の汎用メッセージへ collapse せず、
  // かつ常に Magic Link への案内を含める必要がある。legacy の
  // `SIGN_IN_FEEDBACK` は duplicate/too-many を意図的に同一文言へ寄せる
  // （原因を問わずサインイン不可という意味では同じ結果のため）ので、
  // register 側とは異なり「5種類すべてが異なる」ことは要求しない。
  it("does not collapse every kind into a single universal message", () => {
    const kinds = [
      "cancelled",
      "unsupported",
      "duplicate",
      "too-many",
      "failure",
    ] as const;
    const messages = kinds.map((kind) =>
      JSON.stringify(resolveSignInPasskeyFeedback(kind)),
    );
    expect(new Set(messages).size).toBeGreaterThan(1);
  });

  it("intentionally gives duplicate and too-many the same message (both mean 'use Magic Link instead')", () => {
    expect(resolveSignInPasskeyFeedback("duplicate")).toEqual(
      resolveSignInPasskeyFeedback("too-many"),
    );
  });

  it("always guides the user to the Magic Link fallback", () => {
    const kinds = [
      "cancelled",
      "unsupported",
      "duplicate",
      "too-many",
      "failure",
    ] as const;
    for (const kind of kinds) {
      expect(resolveSignInPasskeyFeedback(kind).description).toContain(
        "メールアドレスからサインインしてください",
      );
    }
  });

  it("gives the failure kind a generic retry-then-fallback message", () => {
    expect(resolveSignInPasskeyFeedback("failure")).toEqual({
      title: "Passkeyサインインに失敗しました",
      description:
        "通信状況を確認してもう一度お試しいただくか、下のメールアドレスからサインインしてください。",
    });
  });
});
