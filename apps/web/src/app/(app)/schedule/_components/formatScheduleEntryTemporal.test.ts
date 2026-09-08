import { describe, expect, it } from "vitest";
import { formatScheduleEntryTemporal } from "./formatScheduleEntryTemporal";

describe("formatScheduleEntryTemporal", () => {
  it("formats a single-day all-day temporal without a range dash", () => {
    expect(
      formatScheduleEntryTemporal({
        kind: "all-day",
        startsOn: "2026-03-05",
        endsOn: "2026-03-05",
      } as never),
    ).toBe("2026-03-05（終日）");
  });

  it("formats a multi-day all-day temporal as a range", () => {
    expect(
      formatScheduleEntryTemporal({
        kind: "all-day",
        startsOn: "2026-03-05",
        endsOn: "2026-03-06",
      } as never),
    ).toBe("2026-03-05 〜 2026-03-06（終日）");
  });

  it("formats a time-bounded temporal with a same-day end as HH:mm only", () => {
    expect(
      formatScheduleEntryTemporal({
        kind: "time-bounded",
        startsAt: "2026-03-10T00:00:00.000Z",
        endsAt: "2026-03-10T09:00:00.000Z",
      } as never),
    ).toBe("2026-03-10 09:00 〜 18:00");
  });

  it("formats a time-bounded temporal with a null endsAt as an open end", () => {
    expect(
      formatScheduleEntryTemporal({
        kind: "time-bounded",
        startsAt: "2026-03-10T00:00:00.000Z",
        endsAt: null,
      } as never),
    ).toBe("2026-03-10 09:00 〜（終了時刻未定）");
  });
});
