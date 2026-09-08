import { describe, expect, it } from "vitest";
import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { classifyScheduleEntryReadResult } from "./entryReadState";

const ENTRY = { id: "e" } as unknown as PersonalScheduleEntry;

describe("classifyScheduleEntryReadResult", () => {
  it("classifies a successful fetch with a found entry as populated", () => {
    expect(classifyScheduleEntryReadResult({ ok: true, value: ENTRY })).toEqual(
      {
        variant: "populated",
        data: ENTRY,
      },
    );
  });

  it("classifies a successful fetch with null (not found in the visible list) as empty - never as unavailable/error", () => {
    expect(classifyScheduleEntryReadResult({ ok: true, value: null })).toEqual({
      variant: "empty",
    });
  });

  it("classifies unauthenticated as unavailable, never empty", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "unauthenticated", message: "サインインが必要です。" },
      }),
    ).toEqual({ variant: "unavailable", message: "サインインが必要です。" });
  });

  it("classifies permission-denied as unavailable, never empty", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "permission-denied", message: "権限がありません。" },
      }),
    ).toEqual({ variant: "unavailable", message: "権限がありません。" });
  });

  it("classifies a generic failure as error, never empty", () => {
    expect(
      classifyScheduleEntryReadResult({
        ok: false,
        error: { kind: "failure", message: "予期しないエラーです。" },
      }),
    ).toEqual({ variant: "error", message: "予期しないエラーです。" });
  });
});
