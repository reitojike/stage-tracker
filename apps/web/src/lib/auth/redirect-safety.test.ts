import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./redirect-safety";

describe("safeRedirectPath", () => {
  it("keeps a same-origin absolute path", () => {
    expect(safeRedirectPath("/")).toBe("/");
    expect(safeRedirectPath("/catalog")).toBe("/catalog");
    expect(safeRedirectPath("/catalog?month=2026-09")).toBe(
      "/catalog?month=2026-09",
    );
    expect(safeRedirectPath("/catalog/events/123?occurrence=456")).toBe(
      "/catalog/events/123?occurrence=456",
    );
  });

  it("falls back to '/' when no target is given", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });

  it("rejects absolute and scheme-relative URLs to another origin", () => {
    expect(safeRedirectPath("https://evil.example")).toBe("/");
    expect(safeRedirectPath("http://evil.example/path")).toBe("/");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("//evil.com/path")).toBe("/");
  });

  it("rejects backslash variants of a scheme-relative URL", () => {
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("\\\\evil.example")).toBe("/");
    expect(safeRedirectPath("/\\/evil.example")).toBe("/");
    expect(safeRedirectPath("\\/evil.example")).toBe("/");
  });

  it("rejects the javascript: pseudo-scheme and other non-path values", () => {
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
    expect(safeRedirectPath("data:text/html,evil")).toBe("/");
  });

  it("rejects a relative path that could escape the origin", () => {
    expect(safeRedirectPath("evil.example")).toBe("/");
    expect(safeRedirectPath("../admin")).toBe("/");
    expect(safeRedirectPath("./catalog")).toBe("/");
  });

  it("rejects control characters, which could otherwise reach the Location header", () => {
    expect(safeRedirectPath("/\r\nSet-Cookie: evil=1")).toBe("/");
    expect(safeRedirectPath("/catalog\r\n")).toBe("/");
    expect(safeRedirectPath("/catalog\n")).toBe("/");
    expect(safeRedirectPath("/catalog\t")).toBe("/");
    expect(safeRedirectPath("/catalog\x00")).toBe("/");
    expect(safeRedirectPath("/catalog\x7f")).toBe("/");
  });
});
