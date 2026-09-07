import { describe, expect, it } from "vitest";

describe("MSW handlers", () => {
  it("returns the mocked response body for the configured handler", async () => {
    const response = await fetch("https://example.test/api/ping");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ message: "pong" });
  });
});
