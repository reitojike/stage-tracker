import { describe, expect, it } from "vitest";
import {
  normalizeMemo,
  parseScheduleEntryTemporal,
  scheduleEntryFormSchema,
} from "./schedule-entry-form";

describe("parseScheduleEntryTemporal", () => {
  it("builds an all-day temporal from startsOn/endsOn", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "all-day",
      allDayStartsOn: "2026-03-05",
      allDayEndsOn: "2026-03-06",
    });
    expect(result).toEqual({
      ok: true,
      value: { kind: "all-day", startsOn: "2026-03-05", endsOn: "2026-03-06" },
    });
  });

  it("defaults an omitted all-day endsOn to startsOn (single-day entry)", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "all-day",
      allDayStartsOn: "2026-03-05",
    });
    expect(result).toEqual({
      ok: true,
      value: { kind: "all-day", startsOn: "2026-03-05", endsOn: "2026-03-05" },
    });
  });

  it("rejects a missing all-day startsOn on the allDayStartsOn field", () => {
    const result = parseScheduleEntryTemporal({ temporalMode: "all-day" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("allDayStartsOn");
    }
  });

  it("rejects an all-day endsOn before startsOn on the allDayEndsOn field (delegates ordering to the domain schema)", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "all-day",
      allDayStartsOn: "2026-03-06",
      allDayEndsOn: "2026-03-05",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("allDayEndsOn");
      // domain schema の invariant メッセージ（開発者向けの英語）を
      // そのまま画面へ出さない。
      expect(result.error.message).toBe(
        "終了日は開始日以降の日付を入力してください。",
      );
      expect(result.error.message).not.toMatch(/[A-Za-z]/u);
    }
  });

  it("builds a time-bounded temporal from an Asia/Tokyo datetime-local start, with a null endsAt when omitted", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: "2026-03-10T09:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        kind: "time-bounded",
        // 09:00 Asia/Tokyo = 00:00 UTC.
        startsAt: "2026-03-10T00:00:00.000Z",
        endsAt: null,
      });
    }
  });

  it("converts a provided endsAt and preserves it", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: "2026-03-10T09:00",
      timeBoundedEndsAt: "2026-03-10T18:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === "time-bounded") {
      expect(result.value.endsAt).toBe("2026-03-10T09:00:00.000Z");
    }
  });

  it("rejects a missing time-bounded startsAt on the timeBoundedStartsAt field", () => {
    const result = parseScheduleEntryTemporal({ temporalMode: "time-bounded" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("timeBoundedStartsAt");
    }
  });

  it("rejects an unreal datetime-local value (e.g. Feb 30) rather than silently rolling it over", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: "2026-02-30T09:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("timeBoundedStartsAt");
    }
  });

  it("rejects a time-bounded endsAt before startsAt on the timeBoundedEndsAt field", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: "2026-03-10T18:00",
      timeBoundedEndsAt: "2026-03-10T09:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe("timeBoundedEndsAt");
      expect(result.error.message).toBe(
        "終了日時は開始日時以降の日時を入力してください。",
      );
      expect(result.error.message).not.toMatch(/[A-Za-z]/u);
    }
  });
});

describe("scheduleEntryFormSchema", () => {
  const baseAllDay = {
    title: "旅行",
    blocking: true,
    temporalMode: "all-day" as const,
    allDayStartsOn: "2026-03-05",
    allDayEndsOn: "2026-03-06",
  };

  it("accepts a well-formed all-day submission", () => {
    const result = scheduleEntryFormSchema.safeParse(baseAllDay);
    expect(result.success).toBe(true);
  });

  it("reports a missing title as a field error, not a thrown exception", () => {
    const result = scheduleEntryFormSchema.safeParse({
      ...baseAllDay,
      title: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "title"),
      ).toBe(true);
    }
  });

  it("surfaces the temporal ordering violation on the exact field, via superRefine delegating to parseScheduleEntryTemporal", () => {
    const result = scheduleEntryFormSchema.safeParse({
      ...baseAllDay,
      allDayStartsOn: "2026-03-06",
      allDayEndsOn: "2026-03-05",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "allDayEndsOn"),
      ).toBe(true);
    }
  });
});

describe("normalizeMemo", () => {
  it("normalizes undefined to null", () => {
    expect(normalizeMemo(undefined)).toBeNull();
  });

  it("normalizes an empty string to null (no separate empty-string state)", () => {
    expect(normalizeMemo("")).toBeNull();
  });

  it("preserves a non-empty memo", () => {
    expect(normalizeMemo("持ち物: チケット")).toBe("持ち物: チケット");
  });
});
