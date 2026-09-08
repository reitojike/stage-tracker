import { describe, expect, it } from "vitest";
import { fieldErrorMessage } from "./validationErrors";

describe("fieldErrorMessage", () => {
  it("returns the first message for a field with errors", () => {
    const validationErrors = { title: { _errors: ["required"] } };
    expect(fieldErrorMessage(validationErrors, "title")).toBe("required");
  });

  it("returns undefined for a field with no errors", () => {
    const validationErrors = { title: { _errors: [] } };
    expect(fieldErrorMessage(validationErrors, "title")).toBeUndefined();
  });

  it("returns undefined when the field is absent", () => {
    const validationErrors = { venue: { _errors: ["x"] } };
    expect(fieldErrorMessage(validationErrors, "title")).toBeUndefined();
  });

  it("returns undefined for null/undefined input", () => {
    expect(fieldErrorMessage(undefined, "title")).toBeUndefined();
    expect(fieldErrorMessage(null, "title")).toBeUndefined();
  });
});
