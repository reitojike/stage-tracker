import { describe, expect, it } from "vitest";
import { passkeyDisplayLabel } from "./passkeyDisplay";

describe("passkeyDisplayLabel", () => {
  it("uses the friendly name when present", () => {
    const label = passkeyDisplayLabel({
      friendly_name: "MacBook",
      created_at: "2026-05-10T09:30:00Z",
    });
    // 2026-05-10T09:30:00Z -> Asia/Tokyo 2026-05-10 18:30
    expect(label).toBe("MacBook — 2026-05-10 18:30");
  });

  it("falls back to a generic label when unnamed", () => {
    const label = passkeyDisplayLabel({ created_at: "2026-05-10T09:30:00Z" });
    expect(label).toBe("登録済みPasskey — 2026-05-10 18:30");
  });

  it("falls back to just the name when created_at cannot be parsed", () => {
    const label = passkeyDisplayLabel({
      friendly_name: "iPhone",
      created_at: "not-a-date",
    });
    expect(label).toBe("iPhone");
  });
});
