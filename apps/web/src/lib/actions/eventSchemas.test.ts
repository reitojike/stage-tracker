import { describe, expect, it } from "vitest";
import {
  addOccurrenceInputSchema,
  createEventInputSchema,
  updateEventRangeInputSchema,
} from "./eventSchemas";

describe("createEventInputSchema", () => {
  it("parses a valid submission with no occurrence", () => {
    const result = createEventInputSchema.safeParse({
      title: "My Event",
      venue: "",
      sourceUrl: "",
      memo: "",
      startsOn: "2026-05-01",
      endsOn: "2026-05-31",
      occurrenceStartsAt: "",
      occurrenceEndsAt: "",
      occurrenceDoorsAt: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.occurrence).toBeNull();
      expect(result.data.details.title).toBe("My Event");
    }
  });

  it("surfaces a field-keyed issue for a blank title", () => {
    const result = createEventInputSchema.safeParse({
      title: "",
      venue: "",
      sourceUrl: "",
      memo: "",
      startsOn: "2026-05-01",
      endsOn: "2026-05-31",
      occurrenceStartsAt: "",
      occurrenceEndsAt: "",
      occurrenceDoorsAt: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "title"),
      ).toBe(true);
    }
  });

  it("remaps occurrence field errors with the occurrence* prefix", () => {
    const result = createEventInputSchema.safeParse({
      title: "My Event",
      venue: "",
      sourceUrl: "",
      memo: "",
      startsOn: "2026-05-01",
      endsOn: "2026-05-31",
      occurrenceStartsAt: "2026-05-10T18:00",
      occurrenceEndsAt: "2026-05-10T17:00",
      occurrenceDoorsAt: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path[0] === "occurrenceEndsAt",
        ),
      ).toBe(true);
    }
  });

  it("accepts an occurrence whose Tokyo calendar date is within the event range", () => {
    const result = createEventInputSchema.safeParse({
      title: "My Event",
      venue: "",
      sourceUrl: "",
      memo: "",
      startsOn: "2026-05-10",
      endsOn: "2026-05-10",
      occurrenceStartsAt: "2026-05-10T18:00",
      occurrenceEndsAt: "",
      occurrenceDoorsAt: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an occurrence outside of the event range even when both are individually valid", () => {
    const result = createEventInputSchema.safeParse({
      title: "My Event",
      venue: "",
      sourceUrl: "",
      memo: "",
      startsOn: "2026-05-10",
      endsOn: "2026-05-10",
      occurrenceStartsAt: "2026-06-01T18:00",
      occurrenceEndsAt: "",
      occurrenceDoorsAt: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path[0] === "occurrenceStartsAt",
        ),
      ).toBe(true);
    }
  });
});

describe("updateEventRangeInputSchema", () => {
  it("requires a valid eventId (uuid)", () => {
    const result = updateEventRangeInputSchema.safeParse({
      eventId: "not-a-uuid",
      startsOn: "2026-05-01",
      endsOn: "2026-05-31",
    });
    expect(result.success).toBe(false);
  });
});

describe("addOccurrenceInputSchema", () => {
  it("requires startsAt (allowBlank: false)", () => {
    const result = addOccurrenceInputSchema.safeParse({
      eventId: "3f6b8b1e-0f2b-4c1a-9c3a-2f6b8b1e0f2b",
      startsAt: "",
      endsAt: "",
      doorsAt: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "startsAt"),
      ).toBe(true);
    }
  });
});
