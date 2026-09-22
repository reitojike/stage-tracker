import { describe, expect, it, vi } from "vitest";
import { getOfficialSource } from "../source-registry";
import { fetchOfficialHtml } from "./http";

const source = getOfficialSource("event.kabuki-bito.schedule");
if (source === null) throw new Error("test source missing");

describe("official HTML fetch boundary", () => {
  it("validates every redirect before sending the next request", async () => {
    const transport = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example/collect" },
        }),
    );
    await expect(
      fetchOfficialHtml(source, source.canonicalUrl, transport),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("follows a bounded same-origin redirect and hashes only the returned body", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "/theaters/kabukiza/play/978" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<main>official facts</main>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      );
    const result = await fetchOfficialHtml(
      source,
      source.canonicalUrl,
      transport,
    );
    expect(result.url).toBe(
      "https://www.kabuki-bito.jp/theaters/kabukiza/play/978",
    );
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects non-HTML and declared oversized responses before reading them", async () => {
    const oversized = vi.fn(
      async () =>
        new Response("not read", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "Content-Length": "2000001",
          },
        }),
    );
    await expect(
      fetchOfficialHtml(source, source.canonicalUrl, oversized),
    ).rejects.toThrow();
  });

  it("classifies a response-body stream failure as a fetch failure", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new Error("connection closed"));
      },
    });
    const transport = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );
    await expect(
      fetchOfficialHtml(source, source.canonicalUrl, transport),
    ).rejects.toMatchObject({ name: "SourceFetchFailure" });
  });
});
