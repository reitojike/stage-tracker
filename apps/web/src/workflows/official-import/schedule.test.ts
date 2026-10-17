import { describe, expect, it } from "vitest";
import { dueScheduledSourceSlots } from "./schedule";
import { deriveOfficialImportScheduledRunId } from "./run-identity";
import {
  getOfficialSource,
  listScheduledShadowSources,
} from "./source-registry";

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

  it("selects both actual cleared sources in Event then Ticket order on Monday", () => {
    expect(
      dueScheduledSourceSlots(
        [ticket, kabuki],
        new Date("2026-10-19T00:00:00.000Z"),
      ),
    ).toEqual([
      { source: kabuki, tokyoDate: "2026-10-19" },
      { source: ticket, tokyoDate: "2026-10-19" },
    ]);
  });

  it.each([20, 21, 22, 23, 24, 25])(
    "excludes both cleared sources on October %i",
    (day) => {
      expect(
        dueScheduledSourceSlots(
          listScheduledShadowSources(),
          new Date(`2026-10-${day}T00:00:00.000Z`),
        ),
      ).toEqual([]);
    },
  );

  it("keeps each source identity stable across duplicate Monday deliveries", () => {
    const runIds = (clock: string) =>
      dueScheduledSourceSlots(
        listScheduledShadowSources(),
        new Date(clock),
      ).map(({ source, tokyoDate }) =>
        deriveOfficialImportScheduledRunId(source.id, tokyoDate),
      );
    const first = runIds("2026-10-19T00:00:00.000Z");
    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(2);
    expect(runIds("2026-10-19T00:10:00.000Z")).toEqual(first);
    expect(runIds("2026-10-26T00:00:00.000Z")).toHaveLength(2);
    for (const next of runIds("2026-10-26T00:00:00.000Z")) {
      expect(first).not.toContain(next);
    }
  });

  it("rejects an invalid clock", () => {
    expect(() =>
      dueScheduledSourceSlots([daily], new Date("invalid")),
    ).toThrow();
  });
});
