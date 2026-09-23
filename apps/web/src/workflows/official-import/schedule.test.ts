import { describe, expect, it } from "vitest";
import { dueScheduledSourceSlots } from "./schedule";
import { getOfficialSource } from "./source-registry";

const daily = getOfficialSource("event.kabuki-bito.schedule");
const weekly = getOfficialSource("ticket.vpass.takarazuka-east");
if (daily === null || weekly === null) throw new Error("test source missing");

describe("official source schedule slots", () => {
  it("uses the Tokyo date and Monday for weekly cadence", () => {
    expect(
      dueScheduledSourceSlots(
        [daily, weekly],
        new Date("2026-09-20T15:00:00.000Z"),
      ),
    ).toEqual([
      { source: daily, tokyoDate: "2026-09-21" },
      { source: weekly, tokyoDate: "2026-09-21" },
    ]);
    expect(
      dueScheduledSourceSlots(
        [daily, weekly],
        new Date("2026-09-21T15:00:00.000Z"),
      ),
    ).toEqual([{ source: daily, tokyoDate: "2026-09-22" }]);
  });

  it("rejects an invalid clock", () => {
    expect(() =>
      dueScheduledSourceSlots([daily], new Date("invalid")),
    ).toThrow();
  });
});
