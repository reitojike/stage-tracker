import { describe, expect, it } from "vitest";
import { redactObservabilityUrl } from "./vercel-observability-url";

describe("redactObservabilityUrl", () => {
  it("drops the auth callback, including a token in its query", () => {
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/auth/confirm?token_hash=secret&type=email",
      ),
    ).toBeNull();
  });

  it("removes sign-in values and notification cursors", () => {
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/sign-in?email=a%40b.test",
      ),
    ).toBe("https://stage-tracker.example/sign-in");
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/notifications?cursor=private&snapshot=private",
      ),
    ).toBe("https://stage-tracker.example/notifications");
  });

  it("normalizes event and schedule IDs while preserving route identity", () => {
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/catalog/events/event-secret?occurrence=occurrence-secret",
      ),
    ).toBe("https://stage-tracker.example/catalog/events/[eventId]");
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/catalog/events/event-secret/edit?month=2026-09",
      ),
    ).toBe("https://stage-tracker.example/catalog/events/[eventId]/edit");
    expect(
      redactObservabilityUrl(
        "https://stage-tracker.example/schedule/entry-secret/edit?month=2026-09",
      ),
    ).toBe("https://stage-tracker.example/schedule/[entryId]/edit");
  });

  it("leaves non-sensitive routes and their date filters unchanged", () => {
    const urls = [
      "https://stage-tracker.example/catalog/events/new?month=2026-09",
      "https://stage-tracker.example/schedule/new?date=2026-09-25",
      "https://stage-tracker.example/calendar?month=2026-09",
    ];
    for (const url of urls) {
      expect(redactObservabilityUrl(url)).toBe(url);
    }
  });

  it("drops malformed URLs instead of sending unknown content", () => {
    expect(redactObservabilityUrl("not a URL?token=secret")).toBeNull();
  });
});
