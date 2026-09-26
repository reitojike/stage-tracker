import { describe, expect, it } from "vitest";
import { getOfficialSource } from "../source-registry";
import { createTakarazukaGeneralSaleAdapter } from "./takarazuka-general-sale";
import type { OfficialHtmlDocument } from "./http";

const source = getOfficialSource("ticket.takarazuka.revue-general-sale");
if (source === null) throw new Error("test source missing");

describe("Takarazuka general-sale index adapter", () => {
  it("stages separate date-only general sales for each published venue", async () => {
    const index = `<div class="item">
      <a href="/sp/revue/2026/elisabeth/index.html"><p class="title">エリザベート</p></a>
      <dl><dt>宝塚大劇場</dt><dd>2026年10月17日～11月22日 一般前売：2026年9月26日</dd></dl>
      <dl><dt>東京宝塚劇場</dt><dd>2026年12月19日～2027年2月7日 一般前売：2026年11月15日</dd></dl>
      <dl><dt>主な出演者</dt><dd>出演者名</dd></dl>
    </div>`;
    const adapter = createTakarazukaGeneralSaleAdapter(
      async (_source, url): Promise<OfficialHtmlDocument> => ({
        url,
        body: index,
        observedAt: "2026-09-27T00:00:00.000Z",
        contentHash: "a".repeat(64),
        etag: null,
        lastModified: null,
      }),
    );
    const drafts = await adapter.acquire(source);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.proposal)).toEqual([
      expect.objectContaining({
        eventSourceKey: "takarazuka:2026:elisabeth:takarazuka",
        sourceKey: "takarazuka:2026:elisabeth:takarazuka:general-sale",
        milestones: [
          { type: "sale_start", precision: "date", date: "2026-09-26" },
        ],
      }),
      expect.objectContaining({
        eventSourceKey: "takarazuka:2026:elisabeth:tokyo",
        sourceKey: "takarazuka:2026:elisabeth:tokyo:general-sale",
        milestones: [
          { type: "sale_start", precision: "date", date: "2026-11-15" },
        ],
      }),
    ]);
  });
});
