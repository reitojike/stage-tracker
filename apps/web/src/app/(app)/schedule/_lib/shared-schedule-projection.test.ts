import { describe, expect, it } from "vitest";
import {
  personalScheduleEntrySchema,
  tokyoCalendarDateSchema,
} from "@stage-tracker/domain";
import { resolveScreenNow } from "@/app/_lib/now";
import {
  buildScheduleIndex,
  projectSharedCalendar,
  projectSharedHome,
  scheduleEntrySortInstant,
} from "./shared-schedule-projection";
import { buildMyCalendarMonthViewModel } from "../../calendar/_lib/calendar-view-model";
import { tokyoYearMonthOf } from "@/app/_lib/calendar-grid";
const date = tokyoCalendarDateSchema.parse("2026-10-16");
const now = resolveScreenNow(Date.parse("2026-10-16T00:00:00Z"));
function entry(n: number) {
  return personalScheduleEntrySchema.parse({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    ownerId:
      n === 99
        ? "11111111-1111-4111-8111-111111111111"
        : "22222222-2222-4222-8222-222222222222",
    title: `private-${n}`,
    memo: null,
    blocking: true,
    temporal: {
      kind: "all-day",
      startsOn: date,
      endsOn: tokyoCalendarDateSchema.parse("2026-10-18"),
    },
    createdAt: now.nowInstant,
    updatedAt: now.nowInstant,
  });
}
describe("shared projection", () => {
  it("preserves Home's independent failure states and its five-item cap", () => {
    const shared = Array.from({ length: 7 }, (_, i) => entry(i + 1));
    const result = projectSharedHome({ variant: "empty" }, shared, now);
    expect(result.variant).toBe("populated");
    if (result.variant === "populated") expect(result.data).toHaveLength(5);
    const ownEntry = entry(99);
    const partial = {
      variant: "partial" as const,
      data: [
        {
          kind: "schedule" as const,
          entry: ownEntry,
          isOwner: true,
          sortInstant: scheduleEntrySortInstant(ownEntry),
        },
      ],
      a: { ok: true as const },
      b: { ok: false as const, variant: "error" as const },
    };
    expect(projectSharedHome(partial, shared, now)).toBe(partial);
    expect(projectSharedHome({ variant: "error" }, shared, now)).toEqual({
      variant: "error",
    });
  });
  it("removes shared entries from all calendar bands and overflow/counts while keeping own entries", () => {
    const own = entry(99),
      shared = Array.from({ length: 7 }, (_, i) => entry(i + 1));
    const ownState = {
      variant: "populated" as const,
      data: buildScheduleIndex([own], date, date),
    };
    const ready = projectSharedCalendar(ownState, shared, date, date);
    const pending = projectSharedCalendar(ownState, [], date, date);
    expect(ready.variant).toBe("populated");
    expect(pending.variant).toBe("populated");
    if (pending.variant !== "populated") throw Error("missing own projection");
    expect(pending.data.items.map((i) => i.entry.title)).toEqual([
      "private-99",
    ]);
    const month = tokyoYearMonthOf(date);
    if (!month) throw Error("invalid test month");
    const model = buildMyCalendarMonthViewModel(
      month,
      { items: [], byDate: new Map() },
      pending.data,
      own.ownerId,
    );
    const json = JSON.stringify(model);
    expect(json).toContain("private-99");
    expect(json).not.toContain('"private-1"');
    expect(
      projectSharedCalendar({ variant: "unavailable" }, shared, date, date),
    ).toEqual({ variant: "unavailable" });
  });
});
