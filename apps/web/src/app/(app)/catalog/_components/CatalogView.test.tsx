import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import type { CatalogFilterOptionsResult } from "../_lib/catalog-loader";
import { CatalogView, type CatalogViewProps } from "./CatalogView";

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
        eventsState={{ variant: "error" }}
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
        eventsState={{ variant: "unavailable" }}
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
        filterOptionsResult={{ ok: false, variant: "error" }}
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

  it("hydrates without a mismatch when a non-default filter selection is already stored, then restores it post-mount", () => {
    window.localStorage.setItem(
      "stage-tracker:catalog-filter:v1",
      JSON.stringify({ genreKey: "takarazuka", groupIds: [], venues: [] }),
    );

    const props: CatalogViewProps = {
      month: MONTH,
      eventsState: {
        variant: "populated",
        data: [entry({ title: "宝塚公演", genreKey: "takarazuka" })],
      },
      filterOptionsResult: OK_FILTER_OPTIONS,
    };
    const element = <CatalogView {...props} />;

    // Simulate the real server render: it never has `window`, so the
    // initial state must ignore the stored (browser-only) selection even
    // though it is already sitting in `localStorage` in this test. Without
    // this, `renderToString` here would run inside jsdom - where `window`
    // is always defined - and would silently "see" the same stored value
    // the real server never can, hiding exactly the bug this test targets.
    const originalWindow = globalThis.window;
    // @ts-expect-error -- deliberately simulating a Node SSR environment
    delete globalThis.window;
    const serverHtml = renderToString(element);
    globalThis.window = originalWindow;

    expect(serverHtml).not.toContain("絞り込み中");

    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);

    // React reports a hydration mismatch through `onRecoverableError`, not
    // through a `console.error` a spy would catch synchronously here: with
    // the pre-fix initializer the mismatch surfaced as an *unhandled* error
    // escaping the test, so the test itself passed. Collecting the
    // recoverable errors makes the detection deterministic.
    const recoverableErrors: string[] = [];

    act(() => {
      hydrateRoot(container, element, {
        onRecoverableError: (error) => {
          recoverableErrors.push(
            error instanceof Error ? error.message : String(error),
          );
        },
      });
    });

    // The initial client (hydration) render must match `serverHtml`
    // exactly. If the old lazy `useState(() => readStoredSelection() ?? ...)`
    // initializer were still in place, this first client render would read
    // the stored selection directly (unlike the server pass above) and
    // React would report a hydration mismatch here.
    expect(recoverableErrors).toEqual([]);

    // The stored selection is still restored - just after mount, via the
    // effect, not during the initial render.
    expect(container.textContent).toContain("絞り込み中");

    document.body.removeChild(container);
  });
});
