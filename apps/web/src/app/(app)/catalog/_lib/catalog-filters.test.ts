import { describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import {
  activeFacetForGenre,
  filterCatalogEntries,
  groupDisplayNameById,
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
  groupsByGenreKey: {
    takarazuka: [
      { id: "group-a" as never, key: "a", displayName: "星組" },
      { id: "group-b" as never, key: "b", displayName: "月組" },
      { id: "group-c" as never, key: "c", displayName: "花組" },
    ],
    // 別 genre (アイドル) の group. 宝塚選択時の option universe に混ざって
    // はならない (下記「genre ごとに group をスコープする」テスト参照)。
    idol: [{ id: "group-d" as never, key: "d", displayName: "テストグループ" }],
  },
  venuesByGenreKey: {
    kabuki: ["東京宝塚劇場", "南座"],
  },
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

  it("scopes group options to the selected genre (does not count another genre's groups as still-unselected)", () => {
    // M8 で確定した v2 の不具合の regression test: 宝塚の3 group 全部を
    // 選択した場合、アイドルの group が別に存在していても「宝塚 facet では
    // 絞り込まない」(= 全選択) と判定されなければならない。旧実装は全
    // genre の group を1つの flat list として数えていたため、宝塚の3件を
    // 選んでも idol の1件が未選択のままとなり、誤って絞り込みが継続した。
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
    expect(result).toHaveLength(2);
  });

  it("does not let a stale (e.g. localStorage-persisted, cross-genre) selected id count toward 'every known option selected'", () => {
    // PR #402 review finding 2 の regression test: pre-fix build が保存した
    // localStorage の選択には、別 genre 由来の group id が混ざり得る
    // (`group-d` は OPTIONS 上 idol の group)。宝塚の既知3件中2件だけを
    // 選んでいるのに、この無関係な id が同じ配列に残っていると、素朴な
    // 「選択数 >= 既知数」比較では 3 >= 3 となり誤って「全選択 (=絞り込み
    // 解除)」と判定されてしまう。stale id を除いた実際の選択数 (2) で
    // 判定しなければならない。
    const entries = [
      entry({ genreKey: "takarazuka", groupIds: ["group-a"] }),
      entry({ genreKey: "takarazuka", groupIds: ["group-c"] }),
    ];
    const result = filterCatalogEntries(
      entries,
      {
        genreKey: "takarazuka",
        groupIds: ["group-a" as never, "group-d" as never],
        venues: [],
      },
      OPTIONS,
    );
    // 絞り込みは有効なままのはず: group-a を持つ event だけがヒットする。
    expect(result).toHaveLength(1);
    expect(result[0]?.classification.groupIds).toEqual(["group-a"]);
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

describe("groupDisplayNameById", () => {
  it("flattens every genre's groups into a single id -> displayName map", () => {
    const byId = groupDisplayNameById(OPTIONS);
    expect(byId.get("group-a" as never)).toBe("星組");
    expect(byId.get("group-b" as never)).toBe("月組");
    expect(byId.get("group-c" as never)).toBe("花組");
    // Flattened across genres too (idol's own group), since a Group's
    // canonical identity is genre-independent (AGENTS.md "Group").
    expect(byId.get("group-d" as never)).toBe("テストグループ");
  });

  it("returns an empty map when there are no group facets at all", () => {
    const byId = groupDisplayNameById({
      genres: [],
      groupsByGenreKey: {},
      venuesByGenreKey: {},
    });
    expect(byId.size).toBe(0);
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
