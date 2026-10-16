import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { PersonalScheduleEntryId } from "@stage-tracker/domain";
import {
  normalizeMemo,
  parseScheduleEntryTemporal,
  scheduleEntryFormSchema,
  scheduleEntryFormWithIdSchema,
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

  it("rejects seconds with the format message while keeping the start field", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: "2026-03-10T09:00:30",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        field: "timeBoundedStartsAt",
        message: "日時の形式が正しくありません。",
      },
    });
  });

  it("classifies malformed and nonexistent schedule datetimes separately", () => {
    expect(
      parseScheduleEntryTemporal({
        temporalMode: "time-bounded",
        timeBoundedStartsAt: "not-a-datetime",
      }),
    ).toEqual({
      ok: false,
      error: {
        field: "timeBoundedStartsAt",
        message: "日時の形式が正しくありません。",
      },
    });
    expect(
      parseScheduleEntryTemporal({
        temporalMode: "time-bounded",
        timeBoundedStartsAt: "2026-02-30T09:00",
      }),
    ).toEqual({
      ok: false,
      error: {
        field: "timeBoundedStartsAt",
        message: "実在する日時を入力してください。",
      },
    });
  });

  it("preserves schedule trim behavior for start and end values", () => {
    const result = parseScheduleEntryTemporal({
      temporalMode: "time-bounded",
      timeBoundedStartsAt: " 2026-03-10T09:00 ",
      timeBoundedEndsAt: " 2026-03-10T18:00 ",
    });
    expect(result.ok).toBe(true);
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

describe.each([
  { name: "create", schema: scheduleEntryFormSchema, extra: {} },
  {
    name: "edit",
    schema: scheduleEntryFormWithIdSchema,
    extra: { entryId: "11111111-1111-4111-8111-111111111111" },
  },
])("$name schedule entry schema", ({ schema, extra }) => {
  const baseAllDay = {
    title: "旅行",
    blocking: true,
    temporalMode: "all-day" as const,
    allDayStartsOn: "2026-03-05",
    allDayEndsOn: "2026-03-06",
    ...extra,
  };

  it("accepts a well-formed all-day submission", () => {
    expect(schema.parse(baseAllDay)).toEqual(baseAllDay);
  });

  it("reports a missing title as a field error, not a thrown exception", () => {
    const result = schema.safeParse({
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
    const result = schema.safeParse({
      ...baseAllDay,
      allDayStartsOn: "2026-03-06",
      allDayEndsOn: "2026-03-05",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        {
          code: "custom",
          path: ["allDayEndsOn"],
          message: "終了日は開始日以降の日付を入力してください。",
        },
      ]);
    }
  });

  const baseTimed = {
    title: "  旅行  ",
    memo: "  持ち物  ",
    blocking: false,
    temporalMode: "time-bounded" as const,
    timeBoundedStartsAt: " 2026-03-10T09:00 ",
    ...extra,
  };

  it("preserves trimmed title/memo, raw temporal input and omitted optional fields", () => {
    expect(schema.parse(baseTimed)).toEqual({
      ...baseTimed,
      title: "旅行",
      memo: "持ち物",
    });
  });

  it.each([
    [
      "timeBoundedEndsAt",
      "2026-03-10T08:59",
      "終了日時は開始日時以降の日時を入力してください。",
    ],
    [
      "timeBoundedStartsAt",
      "2026-02-30T09:00",
      "実在する日時を入力してください。",
    ],
    [
      "timeBoundedEndsAt",
      "2026-02-30T09:00",
      "実在する日時を入力してください。",
    ],
    [
      "timeBoundedStartsAt",
      "2026-03-10T24:00",
      "実在する日時を入力してください。",
    ],
    [
      "timeBoundedStartsAt",
      "2026-03-10T09:00:30",
      "日時の形式が正しくありません。",
    ],
    [
      "timeBoundedEndsAt",
      "2026-03-10T18:00:00",
      "日時の形式が正しくありません。",
    ],
  ])(
    "rejects %s=%s with the existing field path and Japanese message",
    (field, value, message) => {
      const result = schema.safeParse({ ...baseTimed, [field]: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual([
          { code: "custom", path: [field], message },
        ]);
      }
    },
  );
});

describe("schedule schema types and entry identity", () => {
  interface ExpectedForm {
    title: string;
    memo?: string | undefined;
    blocking: boolean;
    temporalMode: "all-day" | "time-bounded";
    allDayStartsOn?: string | undefined;
    allDayEndsOn?: string | undefined;
    timeBoundedStartsAt?: string | undefined;
    timeBoundedEndsAt?: string | undefined;
  }
  interface ExpectedEditInput extends ExpectedForm {
    entryId: string;
  }
  interface ExpectedEditOutput extends ExpectedForm {
    entryId: PersonalScheduleEntryId;
  }

  it("preserves input/output shapes and the edit output's branded ID", () => {
    expectTypeOf<
      z.input<typeof scheduleEntryFormSchema>
    >().toEqualTypeOf<ExpectedForm>();
    expectTypeOf<
      z.output<typeof scheduleEntryFormSchema>
    >().toEqualTypeOf<ExpectedForm>();
    expectTypeOf<
      z.input<typeof scheduleEntryFormWithIdSchema>
    >().toEqualTypeOf<ExpectedEditInput>();
    expectTypeOf<
      z.output<typeof scheduleEntryFormWithIdSchema>
    >().toEqualTypeOf<ExpectedEditOutput>();
  });

  it.each([undefined, "invalid-id"])(
    "requires a valid entryId (%s)",
    (entryId) => {
      const result = scheduleEntryFormWithIdSchema.safeParse({
        title: "旅行",
        blocking: true,
        temporalMode: "all-day",
        allDayStartsOn: "2026-03-05",
        entryId,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["entryId"]);
      }
    },
  );
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
