import { describe, expect, it } from "vitest";
import { isPreviewVercelEnv } from "./vercel-environment";

describe("isPreviewVercelEnv", () => {
  it('is true only for "preview"', () => {
    expect(isPreviewVercelEnv("preview")).toBe(true);
  });

  it('is false for "production"', () => {
    expect(isPreviewVercelEnv("production")).toBe(false);
  });

  it("is false when undefined (local dev / no Vercel framework value)", () => {
    expect(isPreviewVercelEnv(undefined)).toBe(false);
  });

  it("is false for other/unexpected values (no fuzzy match)", () => {
    expect(isPreviewVercelEnv("development")).toBe(false);
    expect(isPreviewVercelEnv("Preview")).toBe(false);
    expect(isPreviewVercelEnv("preview ")).toBe(false);
    expect(isPreviewVercelEnv("")).toBe(false);
  });
});
