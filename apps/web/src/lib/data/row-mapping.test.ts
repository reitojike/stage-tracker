import { describe, expect, it } from "vitest";
import { err, ok, type Result } from "@stage-tracker/domain";
import { mapRows } from "./row-mapping";

interface Row {
  readonly id: string;
  readonly valid: boolean;
}

function mapRow(row: Row): Result<string, string> {
  if (!row.valid) {
    return err(`invalid row ${row.id}`);
  }
  return ok(`mapped-${row.id}`);
}

/**
 * A10 (`docs/v2/decisions.md`) の決定を検証する: mapper は throw せず、
 * 1件でも mapping に失敗したら bulk 全体を `failure` として返し、
 * 失敗行だけをサイレントに間引かない。
 */
describe("mapRows", () => {
  it("maps every row successfully when all rows are valid", () => {
    const result = mapRows(
      [
        { id: "a", valid: true },
        { id: "b", valid: true },
      ],
      mapRow,
    );
    expect(result).toEqual(ok(["mapped-a", "mapped-b"]));
  });

  it("returns an empty array for an empty input (never confused with a mapping failure)", () => {
    const result = mapRows([], mapRow);
    expect(result).toEqual(ok([]));
  });

  it("fails the entire batch when exactly one row is invalid, rather than silently dropping it", () => {
    const result = mapRows(
      [
        { id: "a", valid: true },
        { id: "b", valid: false },
        { id: "c", valid: true },
      ],
      mapRow,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("failure");
      expect(result.error.message).toContain("invalid row b");
    }
  });

  it("fails the entire batch when every row is invalid (must not be reported as 0 successes / empty)", () => {
    const result = mapRows(
      [
        { id: "a", valid: false },
        { id: "b", valid: false },
      ],
      mapRow,
    );
    expect(result.ok).toBe(false);
  });

  it("never throws, even when the mapper itself would - callers only ever see a Result", () => {
    expect(() => mapRows([{ id: "x", valid: false }], mapRow)).not.toThrow();
  });
});
