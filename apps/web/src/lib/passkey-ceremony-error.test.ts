import { describe, expect, it } from "vitest";
import {
  classifyPasskeyCeremonyError,
  resolveRegisterPasskeyFeedback,
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
