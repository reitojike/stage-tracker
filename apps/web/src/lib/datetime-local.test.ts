import { describe, expect, it } from "vitest";
import { parseDateTimeLocal } from "./datetime-local";

describe("parseDateTimeLocal", () => {
  it("accepts minute-only input", () => {
    expect(
      parseDateTimeLocal("2026-05-10T18:00", { syntax: "minute-only" }),
    ).toEqual({ kind: "ok", value: "2026-05-10T09:00:00.000Z" });
  });

  it("rejects seconds in minute-only mode as invalid format", () => {
    expect(
      parseDateTimeLocal("2026-05-10T18:00:30", { syntax: "minute-only" }),
    ).toEqual({ kind: "invalid-format" });
  });

  it("accepts minute input in optional-seconds mode", () => {
    expect(
      parseDateTimeLocal("2026-05-10T18:00", { syntax: "optional-seconds" }),
    ).toEqual({ kind: "ok", value: "2026-05-10T09:00:00.000Z" });
  });

  it("accepts seconds in optional-seconds mode and preserves them", () => {
    expect(
      parseDateTimeLocal("2026-05-10T18:00:30", {
        syntax: "optional-seconds",
      }),
    ).toEqual({ kind: "ok", value: "2026-05-10T09:00:30.000Z" });
  });

  it.each([
    "2026-05-10 18:00",
    "2026-05-10T18",
    "2026-05-10T18:00:00.000",
    "2026-05-10T18:00suffix",
  ])("classifies malformed syntax as invalid format: %s", (raw) => {
    expect(parseDateTimeLocal(raw, { syntax: "optional-seconds" })).toEqual({
      kind: "invalid-format",
    });
  });

  it.each(["2026-02-30T09:00", "2026-05-10T25:00", "2026-05-10T09:99"])(
    "classifies invalid calendar components as invalid calendar time: %s",
    (raw) => {
      expect(parseDateTimeLocal(raw, { syntax: "optional-seconds" })).toEqual({
        kind: "invalid-calendar-time",
      });
    },
  );

  it("classifies an invalid optional second as invalid calendar time", () => {
    expect(
      parseDateTimeLocal("2026-05-10T09:00:99", {
        syntax: "optional-seconds",
      }),
    ).toEqual({ kind: "invalid-calendar-time" });
  });

  it("trims leading and trailing whitespace", () => {
    expect(
      parseDateTimeLocal("  2026-05-10T18:00  ", {
        syntax: "minute-only",
      }),
    ).toEqual({ kind: "ok", value: "2026-05-10T09:00:00.000Z" });
  });
});
