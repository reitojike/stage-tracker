import { describe, expect, it } from "vitest";
import { dueScheduledSourceSlots } from "./schedule";
import { getOfficialSource } from "./source-registry";

const daily = getOfficialSource("event.cynhn.calendar");
const kabuki = getOfficialSource("event.kabuki-bito.schedule");
const ticket = getOfficialSource("ticket.shochiku.schedule");
if (daily === null || kabuki === null || ticket === null)
  throw new Error("test source missing");
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

  it("runs both cleared Kabuki Event and Shochiku Ticket sources in the daily slot", () => {
    expect(
      dueScheduledSourceSlots(
        [ticket, kabuki],
        new Date("2026-09-22T00:00:00.000Z"),
      ),
    ).toEqual([
      { source: kabuki, tokyoDate: "2026-09-22" },
      { source: ticket, tokyoDate: "2026-09-22" },
    ]);
  });

  it("keeps Event before Ticket after both sources return to weekly cadence", () => {
    const weeklyTicket = { ...ticket, fetchCadenceHint: "weekly" as const };
    expect(
      dueScheduledSourceSlots(
        [weeklyTicket, weekly],
        new Date("2026-09-28T00:00:00.000Z"),
      ),
    ).toEqual([
      { source: weekly, tokyoDate: "2026-09-28" },
      { source: weeklyTicket, tokyoDate: "2026-09-28" },
    ]);
    expect(
      dueScheduledSourceSlots(
        [weeklyTicket, weekly],
        new Date("2026-09-29T00:00:00.000Z"),
      ),
    ).toEqual([]);
  });

  it("rejects an invalid clock", () => {
    expect(() =>
      dueScheduledSourceSlots([daily], new Date("invalid")),
    ).toThrow();
  });
});
