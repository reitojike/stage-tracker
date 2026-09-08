import { describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import {
  activeFacetForGenre,
  filterCatalogEntries,
  isCatalogFilterSelectionActive,
  type CatalogFilterOptions,
} from "./catalog-filters";

function entry(
  overrides: Partial<{
    genreKey: string | null;
    groupIds: readonly string[];
    venue: string | null;
  }> = {},
): EventCatalogEntry {
  const { genreKey = null, groupIds = [], venue = null } = overrides;
  return {
    event: {
      id: "22222222-2222-4222-8222-222222222222",
      ownerId: "11111111-1111-4111-8111-111111111111",
      title: "テスト公演",
      venue,
      sourceUrl: null,
      memo: null,
      startsOn: "2026-03-01",
      endsOn: "2026-03-31",
      canceledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrences: [],
    classification: {
      eventId: "22222222-2222-4222-8222-222222222222" as never,
      genre:
        genreKey === null
          ? null
          : ({
              id: `${genreKey}-id`,
              key: genreKey,
              displayName: genreKey,
              sortOrder: 1,
            } as never),
      groupIds: groupIds as never,
    },
  };
}

const OPTIONS: CatalogFilterOptions = {
  genres: [],
  groups: [
    { id: "group-a" as never, key: "a", displayName: "星組" },
    { id: "group-b" as never, key: "b", displayName: "月組" },
    { id: "group-c" as never, key: "c", displayName: "花組" },
  ],
  venues: ["東京宝塚劇場", "南座"],
};

describe("activeFacetForGenre", () => {
  it("maps 宝塚/アイドル to group, 歌舞伎 to venue, and すべて to no facet", () => {
    expect(activeFacetForGenre("takarazuka")).toBe("group");
    expect(activeFacetForGenre("idol")).toBe("group");
    expect(activeFacetForGenre("kabuki")).toBe("venue");
    expect(activeFacetForGenre(null)).toBeNull();
  });
});

describe("filterCatalogEntries", () => {
  it("returns everything when no filter is selected", () => {
    const entries = [entry(), entry({ genreKey: "takarazuka" })];
    expect(
      filterCatalogEntries(
        entries,
        { genreKey: null, groupIds: [], venues: [] },
        OPTIONS,
      ),
    ).toHaveLength(2);
  });

  it("excludes an unclassified event when a specific genre is selected", () => {
    const entries = [entry(), entry({ genreKey: "takarazuka" })];
    const result = filterCatalogEntries(
      entries,
      { genreKey: "takarazuka", groupIds: [], venues: [] },
      OPTIONS,
    );
    expect(result).toHaveLength(1);
  });

  it("applies OR semantics within the group facet", () => {
    const entries = [
      entry({ genreKey: "takarazuka", groupIds: ["group-a"] }),
      entry({ genreKey: "takarazuka", groupIds: ["group-b"] }),
      entry({ genreKey: "takarazuka", groupIds: [] }),
    ];
    const result = filterCatalogEntries(
      entries,
      {
        genreKey: "takarazuka",
        groupIds: ["group-a" as never, "group-b" as never],
        venues: [],
      },
      OPTIONS,
    );
    expect(result).toHaveLength(2);
  });

  it("treats selecting every known group as not filtering by group", () => {
    const entries = [
      entry({ genreKey: "takarazuka", groupIds: ["group-a"] }),
      entry({ genreKey: "takarazuka", groupIds: [] }),
    ];
    const result = filterCatalogEntries(
      entries,
      {
        genreKey: "takarazuka",
        groupIds: ["group-a" as never, "group-b" as never, "group-c" as never],
        venues: [],
      },
      OPTIONS,
    );
    // group-a, group-b, and group-c (= every known group) all selected ->
    // group facet does not filter, so the group-less event still matches.
    expect(result).toHaveLength(2);
  });

  it("applies the venue facet only for the genre whose active facet is venue", () => {
    const entries = [
      entry({ genreKey: "kabuki", venue: "南座" }),
      entry({ genreKey: "kabuki", venue: "東京宝塚劇場" }),
    ];
    const result = filterCatalogEntries(
      entries,
      { genreKey: "kabuki", groupIds: [], venues: ["南座"] },
      OPTIONS,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.event.venue).toBe("南座");
  });

  it("never guesses a classification an event does not have (no match by inference)", () => {
    const entries = [entry({ genreKey: null, groupIds: [] })];
    const result = filterCatalogEntries(
      entries,
      { genreKey: "takarazuka", groupIds: [], venues: [] },
      OPTIONS,
    );
    expect(result).toHaveLength(0);
  });
});

describe("isCatalogFilterSelectionActive", () => {
  it("is false for the default selection and true once any facet is set", () => {
    expect(
      isCatalogFilterSelectionActive({
        genreKey: null,
        groupIds: [],
        venues: [],
      }),
    ).toBe(false);
    expect(
      isCatalogFilterSelectionActive({
        genreKey: "takarazuka",
        groupIds: [],
        venues: [],
      }),
    ).toBe(true);
  });
});
