import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import type { CatalogFilterOptionsResult } from "../_lib/catalog-loader";
import { CatalogView } from "./CatalogView";

const MONTH = { year: 2026, month: 3 };

function entry(
  overrides: Partial<{
    id: string;
    title: string;
    genreKey: string | null;
  }> = {},
): EventCatalogEntry {
  const {
    id = "22222222-2222-4222-8222-222222222222",
    title = "テスト公演",
    genreKey = null,
  } = overrides;
  return {
    event: {
      id,
      ownerId: "11111111-1111-4111-8111-111111111111",
      title,
      venue: null,
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
      eventId: id as never,
      genre:
        genreKey === null
          ? null
          : ({
              id: `${genreKey}-id`,
              key: genreKey,
              displayName: "宝塚",
              sortOrder: 1,
            } as never),
      groupIds: [],
    },
  };
}

const OK_FILTER_OPTIONS: CatalogFilterOptionsResult = {
  ok: true,
  options: { genres: [], groups: [], venues: [] },
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("CatalogView", () => {
  it("renders the raw-empty panel and does not mount filter controls", () => {
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "empty" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
      />,
    );

    expect(
      screen.getByText("この月に登録されているイベントはありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/絞り込み/)).not.toBeInTheDocument();
  });

  it("renders the error panel and does not mount filter controls (error blocks everything)", () => {
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "error", message: "boom" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "カタログを読み込めませんでした",
    );
    expect(screen.queryByText(/絞り込み/)).not.toBeInTheDocument();
  });

  it("renders the unavailable panel distinctly from error", () => {
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "unavailable", message: "denied" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
      />,
    );

    expect(screen.getByText("カタログを確認できません")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the event list and still shows it when the filter option chain fails (partial degradation)", () => {
    const entries = [entry({ title: "宝塚公演" })];
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={{ ok: false, variant: "error", message: "boom" }}
      />,
    );

    expect(screen.getByText("絞り込みを利用できません")).toBeInTheDocument();
    expect(screen.getByText("宝塚公演")).toBeInTheDocument();
  });

  it("distinguishes post-filter empty from raw empty, with a reset action", async () => {
    const user = userEvent.setup();
    const entries = [entry({ title: "歌舞伎公演", genreKey: "kabuki" })];
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={{
          ok: true,
          options: {
            genres: [
              {
                id: "g1" as never,
                key: "takarazuka",
                displayName: "宝塚",
                sortOrder: 1,
              },
            ],
            groups: [],
            venues: [],
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("radio", { name: "宝塚" }));
    await user.click(
      screen.getByRole("button", { name: "この条件で絞り込む" }),
    );

    expect(
      screen.getByText("条件に合うイベントがありません"),
    ).toBeInTheDocument();
    expect(screen.queryByText("歌舞伎公演")).not.toBeInTheDocument();

    await user.click(
      within(
        screen.getByText("条件に合うイベントがありません").closest("div")!,
      ).getByRole("button", { name: "条件を解除する" }),
    );

    expect(screen.getByText("歌舞伎公演")).toBeInTheDocument();
  });

  it("persists the applied filter selection to localStorage", async () => {
    const user = userEvent.setup();
    const entries = [entry({ title: "宝塚公演", genreKey: "takarazuka" })];
    render(
      <CatalogView
        month={MONTH}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={{
          ok: true,
          options: {
            genres: [
              {
                id: "g1" as never,
                key: "takarazuka",
                displayName: "宝塚",
                sortOrder: 1,
              },
            ],
            groups: [],
            venues: [],
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /絞り込み/ }));
    await user.click(screen.getByRole("radio", { name: "宝塚" }));
    await user.click(
      screen.getByRole("button", { name: "この条件で絞り込む" }),
    );

    const stored = window.localStorage.getItem(
      "stage-tracker:catalog-filter:v1",
    );
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "{}")).toMatchObject({
      genreKey: "takarazuka",
    });
  });
});
