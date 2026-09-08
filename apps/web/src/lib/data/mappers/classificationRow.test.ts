import { describe, expect, it } from "vitest";
import {
  mapGenreRow,
  mapGroupRow,
  type GenreRow,
  type GroupRow,
} from "./classificationRow";

describe("mapGenreRow", () => {
  const baseRow: GenreRow = {
    id: "11111111-1111-4111-8111-111111111111",
    key: "takarazuka",
    display_name: "宝塚",
    sort_order: 1,
  };

  it("maps a well-formed seed genre row", () => {
    const result = mapGenreRow(baseRow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        key: "takarazuka",
        displayName: "宝塚",
        sortOrder: 1,
      });
    }
  });

  it("returns an error (never throws) for an empty key", () => {
    const result = mapGenreRow({ ...baseRow, key: "" });
    expect(result.ok).toBe(false);
  });
});

describe("mapGroupRow", () => {
  const baseRow: GroupRow = {
    id: "22222222-2222-4222-8222-222222222222",
    key: "hoshigumi",
    display_name: "星組",
  };

  it("maps a well-formed group row", () => {
    const result = mapGroupRow(baseRow);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        key: "hoshigumi",
        displayName: "星組",
      });
    }
  });

  it("returns an error (never throws) for an empty displayName", () => {
    const result = mapGroupRow({ ...baseRow, display_name: "" });
    expect(result.ok).toBe(false);
  });
});
