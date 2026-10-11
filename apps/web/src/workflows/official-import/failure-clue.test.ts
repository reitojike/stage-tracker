import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceParseFailure } from "./acquisition";
import { createTerminalFailureClue, safeFailureUrl } from "./failure-clue";
import { requireEnabledShadowSource } from "./source-registry";
const kabuki = requireEnabledShadowSource("event.kabuki-bito.schedule");
const safe = "https://www.kabuki-bito.jp/theaters/kabukiza/play/986";
describe("bounded terminal clues", () => {
  it.each([
    ["event.kabuki-bito.schedule", safe, safe],
    [
      "event.kabuki-bito.schedule",
      "https://www.kabuki-bito.jp/schedule/?email=private@example.test#private",
      "https://www.kabuki-bito.jp/schedule/",
    ],
    [
      "ticket.shochiku.schedule",
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_east.html",
    ],
    ["ticket.shochiku.schedule", safe, safe],
    [
      "event.takarazuka.revue",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_tokyo.html",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_tokyo.html",
    ],
    [
      "ticket.takarazuka.revue-general-sale",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/ticket_takarazuka.html",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/ticket_takarazuka.html",
    ],
    [
      "ticket.takarazuka.revue-general-sale",
      "https://kageki.hankyu.co.jp/revue/2027/example/ticket_tokyo.html",
      null,
    ],
    [
      "event.takarazuka.revue",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_other.html",
      null,
    ],
    [
      "event.kabuki-bito.schedule",
      "https://www1.ticket-web-shochiku.com/t/info/schedule.html",
      null,
    ],
  ])("keeps only source locators %s %s", (id, url, expected) =>
    expect(safeFailureUrl(requireEnabledShadowSource(id ?? ""), url)).toBe(
      expected,
    ),
  );
  it.each([
    null,
    undefined,
    {},
    "RAW_SENTINEL",
    "https://evil.test/private",
    "https://user:secret@www.kabuki-bito.jp/schedule/",
    "https://www.kabuki-bito.jp/theaters/other/play/%70rivate",
    safe + "a".repeat(3000),
  ])("drops unsafe/invalid values %j", (value) =>
    expect(safeFailureUrl(kabuki, value)).toBeNull(),
  );
  it("does not read arbitrary exception text", () => {
    const error = {
      get message() {
        throw new Error("RAW_SENTINEL");
      },
      url: "https://evil.test/private",
      stack: "RAW_SENTINEL",
    };
    expect(
      createTerminalFailureClue(kabuki, error, "unexpected", "planning", safe),
    ).toEqual({ phase: "planning", reason: "unexpected", url: safe });
  });
  it("drops construction faults without masking classification", () => {
    const error = new SourceParseFailure(safe);
    Object.defineProperty(error, "canonicalUrl", {
      get() {
        throw new Error("RAW_SENTINEL");
      },
    });
    expect(
      createTerminalFailureClue(
        kabuki,
        error,
        "source_parse",
        "acquisition",
        null,
      ),
    ).toBeUndefined();
  });
  it("publication cannot use previous item URL", () =>
    expect(
      createTerminalFailureClue(
        kabuki,
        new SourceParseFailure(safe),
        "source_parse",
        "publication",
        safe,
      ),
    ).toEqual({
      phase: "publication",
      reason: "unsupported_format",
      url: null,
    }));
  it("keeps SQL and runtime locator shapes in parity", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "../../supabase/migrations/20261011000000_official_import_terminal_failure_clues.sql",
      ),
      "utf8",
    );
    const patterns = [...sql.matchAll(/p_failure_url ~ '([^']+)'/g)].flatMap(
      (match) => (match[1] === undefined ? [] : [new RegExp(match[1])]),
    );
    const urls = [
      safe,
      "https://www.kabuki-bito.jp/schedule/",
      "https://www1.ticket-web-shochiku.com/t/info/sale_schedule_west.html",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_tokyo.html",
      "https://kageki.hankyu.co.jp/sp/revue/2027/example/schedule_other.html",
      safe + "?private=yes",
      "https://evil.test/private",
    ];
    const positions = [[0], [1, 2], [3], [4]];
    const ids = [
      "event.kabuki-bito.schedule",
      "ticket.shochiku.schedule",
      "event.takarazuka.revue",
      "ticket.takarazuka.revue-general-sale",
    ];
    expect(patterns).toHaveLength(5);
    for (const [i, id] of ids.entries())
      for (const url of urls) {
        const indices = positions[i] ?? [];
        const sourcePatterns = patterns.filter((_pattern, index) =>
          indices.includes(index),
        );
        const canonical = safeFailureUrl(requireEnabledShadowSource(id), url);
        if (canonical !== null)
          expect(
            sourcePatterns.some((pattern) => pattern.test(canonical)),
          ).toBe(true);
        const sqlAllowed =
          sourcePatterns.some((pattern) => pattern.test(url)) &&
          (i !== 3 || url.startsWith("https://kageki.hankyu.co.jp/sp/revue/"));
        if (!url.includes("?")) expect(canonical !== null).toBe(sqlAllowed);
      }
  });
});
