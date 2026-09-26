import { describe, expect, it } from "vitest";
import { dueScheduledSourceSlots } from "./schedule";
import { getOfficialSource } from "./source-registry";

const daily = getOfficialSource("event.cynhn.calendar");
const kabuki = getOfficialSource("event.kabuki-bito.schedule");
if (daily === null || kabuki === null) throw new Error("test source missing");
const weekly = { ...kabuki, fetchCadenceHint: "weekly" as const };

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

  it("includes the observed Kabuki source on non-Mondays during daily trial", () => {
    expect(
      dueScheduledSourceSlots([kabuki], new Date("2026-09-21T00:00:00.000Z")),
    ).toEqual([{ source: kabuki, tokyoDate: "2026-09-21" }]);
    expect(
      dueScheduledSourceSlots([kabuki], new Date("2026-09-22T00:00:00.000Z")),
    ).toEqual([{ source: kabuki, tokyoDate: "2026-09-22" }]);
  });

  it("rejects an invalid clock", () => {
    expect(() =>
      dueScheduledSourceSlots([daily], new Date("invalid")),
    ).toThrow();
  });
});
