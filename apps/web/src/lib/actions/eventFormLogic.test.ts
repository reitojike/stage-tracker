import { describe, expect, it } from "vitest";
import {
  occurrenceWithinRangeError,
  parseEventDetailsFields,
  parseEventRangeFields,
  parseOccurrenceFields,
} from "./eventFormLogic";

describe("parseEventDetailsFields", () => {
  it("requires a non-blank title", () => {
    const result = parseEventDetailsFields({
      title: "   ",
      venue: "",
      sourceUrl: "",
      memo: "",
    });
    expect(result).toEqual({
      kind: "errors",
      errors: { title: "タイトルを入力してください。" },
    });
  });

  it("treats blank optional fields as null", () => {
    const result = parseEventDetailsFields({
      title: "My Event",
      venue: "  ",
      sourceUrl: "",
      memo: "\t",
    });
    expect(result).toEqual({
      kind: "ok",
      value: { title: "My Event", venue: null, sourceUrl: null, memo: null },
    });
  });

  it("rejects a sourceUrl that is not a renderable http(s) URL", () => {
    const result = parseEventDetailsFields({
      title: "My Event",
      venue: "",
      sourceUrl: "javascript:alert(1)",
      memo: "",
    });
    expect(result).toEqual({
      kind: "errors",
      errors: {
        sourceUrl: "http:// または https:// で始まるURLを入力してください。",
      },
    });
  });

  it("accepts an https sourceUrl", () => {
    const result = parseEventDetailsFields({
      title: "My Event",
      venue: "Tokyo Dome",
      sourceUrl: "https://example.com/x",
      memo: "note",
    });
    expect(result).toEqual({
      kind: "ok",
      value: {
        title: "My Event",
        venue: "Tokyo Dome",
        sourceUrl: "https://example.com/x",
        memo: "note",
      },
    });
  });
});

describe("parseEventRangeFields", () => {
  it("requires both dates", () => {
    const result = parseEventRangeFields("", "");
    expect(result).toEqual({
      kind: "errors",
      errors: {
        startsOn: "開催期間の開始日を入力してください。",
        endsOn: "開催期間の終了日を入力してください。",
      },
    });
  });

  it("rejects endsOn before startsOn", () => {
    const result = parseEventRangeFields("2026-05-10", "2026-05-01");
    expect(result).toEqual({
      kind: "errors",
      errors: { endsOn: "終了日は開始日より前にできません。" },
    });
  });

  it("accepts startsOn === endsOn (single-day event)", () => {
    const result = parseEventRangeFields("2026-05-10", "2026-05-10");
    expect(result.kind).toBe("ok");
  });
});

describe("parseOccurrenceFields", () => {
  it("returns blank when allowBlank and all 3 fields are empty", () => {
    const result = parseOccurrenceFields(
      { startsAt: "", endsAt: "", doorsAt: "" },
      { allowBlank: true },
    );
    expect(result).toEqual({ kind: "blank" });
  });

  it("requires startsAt when allowBlank is false, even if all fields are empty", () => {
    const result = parseOccurrenceFields(
      { startsAt: "", endsAt: "", doorsAt: "" },
      { allowBlank: false },
    );
    expect(result).toEqual({
      kind: "errors",
      errors: { startsAt: "開演日時を入力してください。" },
    });
  });

  it("rejects doorsAt after startsAt", () => {
    const result = parseOccurrenceFields(
      {
        startsAt: "2026-05-10T18:00",
        endsAt: "",
        doorsAt: "2026-05-10T19:00",
      },
      { allowBlank: true },
    );
    expect(result).toEqual({
      kind: "errors",
      errors: { doorsAt: "開場日時は開演日時より後にできません。" },
    });
  });

  it("rejects endsAt before startsAt", () => {
    const result = parseOccurrenceFields(
      {
        startsAt: "2026-05-10T18:00",
        endsAt: "2026-05-10T17:00",
        doorsAt: "",
      },
      { allowBlank: true },
    );
    expect(result).toEqual({
      kind: "errors",
      errors: { endsAt: "終演日時は開演日時より前にできません。" },
    });
  });

  it("accepts a fully valid occurrence with doors <= starts <= ends", () => {
    const result = parseOccurrenceFields(
      {
        startsAt: "2026-05-10T18:00",
        endsAt: "2026-05-10T20:30",
        doorsAt: "2026-05-10T17:30",
      },
      { allowBlank: true },
    );
    expect(result.kind).toBe("ok");
  });
});

describe("occurrenceWithinRangeError", () => {
  it("returns null when the occurrence's Tokyo calendar date is within range", () => {
    const parsed = parseOccurrenceFields(
      { startsAt: "2026-05-10T18:00", endsAt: "", doorsAt: "" },
      { allowBlank: false },
    );
    if (parsed.kind !== "ok") {
      throw new Error("expected ok");
    }
    const range = parseEventRangeFields("2026-05-01", "2026-05-31");
    if (range.kind !== "ok") {
      throw new Error("expected ok");
    }
    expect(occurrenceWithinRangeError(parsed.value.startsAt, range.value)).toBe(
      null,
    );
  });

  it("returns an error when the occurrence falls outside the event range", () => {
    const parsed = parseOccurrenceFields(
      { startsAt: "2026-06-01T18:00", endsAt: "", doorsAt: "" },
      { allowBlank: false },
    );
    if (parsed.kind !== "ok") {
      throw new Error("expected ok");
    }
    const range = parseEventRangeFields("2026-05-01", "2026-05-31");
    if (range.kind !== "ok") {
      throw new Error("expected ok");
    }
    const error = occurrenceWithinRangeError(
      parsed.value.startsAt,
      range.value,
    );
    expect(error).toBe(
      "開演日時は開催期間（5月1日(金) 〜 5月31日(日)）の範囲内で入力してください。",
    );
    expect(error).not.toContain("2026-05-01〜2026-05-31");
  });
});
