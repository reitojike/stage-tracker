import { describe, expect, it } from "vitest";
import { personalScheduleEntrySchema } from "@stage-tracker/domain";
import { classifyScheduleEntryReadResult } from "./entryReadState";

const ENTRY = personalScheduleEntrySchema.parse({
  id: "11111111-1111-4111-8111-111111111111",
  ownerId: "22222222-2222-4222-8222-222222222222",
  title: "予定",
  memo: null,
  blocking: true,
  temporal: {
    kind: "all-day",
    startsOn: "2026-03-05",
    endsOn: "2026-03-05",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("classifyScheduleEntryReadResult", () => {
  it("classifies a successful fetch with a found entry as populated", () => {
    expect(classifyScheduleEntryReadResult({ ok: true, value: ENTRY })).toEqual(
      {
        variant: "populated",
        data: ENTRY,
      },
    );
  });

  it("classifies a successful fetch with null (not found or invisible) as empty - never as unavailable/error", () => {
    expect(classifyScheduleEntryReadResult({ ok: true, value: null })).toEqual({
      variant: "empty",
    });
  });

  it("classifies unauthenticated as unavailable, never empty, and never carries a message (PR #381 review finding 2)", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "unauthenticated", message: "サインインが必要です。" },
      }),
    ).toEqual({ variant: "unavailable" });
  });

  it("classifies permission-denied as unavailable, never empty, and never carries a message", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "permission-denied", message: "権限がありません。" },
      }),
    ).toEqual({ variant: "unavailable" });
  });

  it("classifies a generic failure as error, never empty, and never carries a message", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "failure", message: "予期しないエラーです。" },
      }),
    ).toEqual({ variant: "error" });
  });
});
