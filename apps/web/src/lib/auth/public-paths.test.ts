import { describe, expect, it } from "vitest";
import { isPublicPath, PUBLIC_PATHS } from "./public-paths";

describe("PUBLIC_PATHS / isPublicPath", () => {
  it("declares exactly the sign-in and magic-link callback routes as public", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(["/auth/confirm", "/sign-in"]);
  });

  it("allows the two explicitly public paths", () => {
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });

  it("denies by default: any path not on the allowlist requires auth", () => {
    const mustBeDenied = [
      "/",
      "/catalog",
      "/catalog/events/new",
      "/mypage",
      "/calendar",
      "/tickets",
      "/schedule/new",
      "/api/foo",
      "/manifest.webmanifest",
      "/pwa/icon-192.png",
      "//evil.com",
      "/unknown-future-route",
    ];

    for (const path of mustBeDenied) {
      expect(isPublicPath(path), `expected "${path}" to be denied`).toBe(false);
    }
  });

  it("does not treat descendants of a public path as public (exact match only)", () => {
    const descendants = [
      "/sign-in/",
      "/sign-in/internal",
      "/auth/confirm/",
      "/auth/confirm/debug",
      "/auth",
      "/auth/",
    ];

    for (const path of descendants) {
      expect(isPublicPath(path), `expected "${path}" to be denied`).toBe(false);
    }
  });

  it("is case-sensitive and does not fuzzy-match", () => {
    expect(isPublicPath("/Sign-in")).toBe(false);
    expect(isPublicPath("/SIGN-IN")).toBe(false);
    expect(isPublicPath("/auth/Confirm")).toBe(false);
  });

  it("treats an empty string as denied, not as a wildcard", () => {
    expect(isPublicPath("")).toBe(false);
  });
});
