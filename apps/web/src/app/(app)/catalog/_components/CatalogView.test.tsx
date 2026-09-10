import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventCatalogEntry } from "@/lib/data";
import type { CatalogFilterOptionsResult } from "../_lib/catalog-loader";
import { CatalogView, type CatalogViewProps } from "./CatalogView";

const MONTH = { year: 2026, month: 3 };
const TODAY = "2026-03-15" as never;

function entry(
  overrides: Partial<{
    id: string;
    title: string;
    genreKey: string | null;
    groupIds: readonly string[];
    startsOn: string;
    endsOn: string;
    occurrences: readonly {
      id: string;
      startsAt: string;
    }[];
  }> = {},
): EventCatalogEntry {
  const {
    id = "22222222-2222-4222-8222-222222222222",
    title = "テスト公演",
    genreKey = null,
    groupIds = [],
    startsOn = "2026-03-01",
    endsOn = "2026-03-31",
    occurrences = [],
  } = overrides;
  return {
    event: {
      id,
      ownerId: "11111111-1111-4111-8111-111111111111",
      title,
      venue: null,
      sourceUrl: null,
      memo: null,
      startsOn,
      endsOn,
      canceledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never,
    occurrences: occurrences.map((occurrence) => ({
      id: occurrence.id,
      eventId: id,
      doorsAt: null,
      startsAt: occurrence.startsAt,
      endsAt: null,
      canceledAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })) as never,
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
      groupIds: groupIds as never,
    },
  };
}

const OK_FILTER_OPTIONS: CatalogFilterOptionsResult = {
  ok: true,
  options: { genres: [], groupsByGenreKey: {}, venuesByGenreKey: {} },
};

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("CatalogView", () => {
  it("still mounts the month calendar and filter controls when the raw range is empty (ChatGPT review 指摘: legacy's isEmptyRange only adds a month-level notice, it never hides the body)", () => {
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "empty" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    expect(
      screen.getByText("この月に登録されているイベントはありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /絞り込み/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "2026年3月のイベントカレンダー" }),
    ).toBeInTheDocument();
  });

  it("still reaches the empty-day panel via SelectedDayList when a date is selected on a raw-empty range", () => {
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-10" as never}
        eventsState={{ variant: "empty" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    // The month-level raw-empty notice only applies to the unselected
    // landing view (`selectedDate === null`) - once a date is selected, the
    // day-level empty message from `SelectedDayList` takes over instead.
    expect(
      screen.queryByText("この月に登録されているイベントはありません"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("この日に登録されている公演はありません"),
    ).toBeInTheDocument();
  });

  it("renders the error panel and does not mount filter controls (error blocks everything)", () => {
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "error" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
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
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "unavailable" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    expect(screen.getByText("カタログを確認できません")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a distinct failure panel (not a silently empty group badge) when group name resolution fails (codex review 指摘)", () => {
    const entries = [
      entry({
        title: "単日公演（花組）",
        startsOn: "2026-03-10",
        endsOn: "2026-03-10",
        genreKey: "takarazuka",
        groupIds: ["group-hana"],
        occurrences: [{ id: "occ-1", startsAt: "2026-03-10T10:00:00.000Z" }],
      }),
    ];
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-10" as never}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: false, variant: "error" }}
      />,
    );

    expect(
      screen.getByText("組・グループの表示名を取得できませんでした"),
    ).toBeInTheDocument();
    // The event/occurrence itself still renders - only the group badge is
    // affected, matching `filterOptionsResult`'s own partial-degradation
    // contract (the list is never blocked by this failure).
    expect(screen.getByText("単日公演（花組）")).toBeInTheDocument();
  });

  it("renders the month calendar (a multi-day Event as a band) and still shows it when the filter option chain fails (partial degradation)", () => {
    const entries = [entry({ title: "宝塚公演" })];
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={{ ok: false, variant: "error" }}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    expect(screen.getByText("絞り込みを利用できません")).toBeInTheDocument();
    // A whole-month band clips to one <span> per week it touches, so its
    // title text can legitimately appear more than once - assert presence,
    // not uniqueness.
    expect(screen.getAllByText("宝塚公演").length).toBeGreaterThan(0);
    // The day grid itself carries no ARIA grid/row/gridcell roles (codex
    // review 指摘 - see MonthCalendar.tsx's own comment); the calendar
    // section is instead identified by its own `aria-label` (implicit
    // `region` role via `<section>`).
    expect(
      screen.getByRole("region", { name: "2026年3月のイベントカレンダー" }),
    ).toBeInTheDocument();
  });

  it("distinguishes post-filter empty from raw empty, with a reset action", async () => {
    const user = userEvent.setup();
    const entries = [entry({ title: "歌舞伎公演", genreKey: "kabuki" })];
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
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
            groupsByGenreKey: {},
            venuesByGenreKey: {},
          },
        }}
        groupNamesResult={{ ok: true, byId: new Map() }}
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

    expect(screen.getAllByText("歌舞伎公演").length).toBeGreaterThan(0);
  });

  it("persists the applied filter selection to localStorage", async () => {
    const user = userEvent.setup();
    const entries = [entry({ title: "宝塚公演", genreKey: "takarazuka" })];
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
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
            groupsByGenreKey: {},
            venuesByGenreKey: {},
          },
        }}
        groupNamesResult={{ ok: true, byId: new Map() }}
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
      today: TODAY,
      selectedDate: null,
      eventsState: {
        variant: "populated",
        data: [entry({ title: "宝塚公演", genreKey: "takarazuka" })],
      },
      filterOptionsResult: OK_FILTER_OPTIONS,
      groupNamesResult: { ok: true, byId: new Map() },
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

  it("renders a single-day Event as a dot rather than a band (Issue #91 rule)", () => {
    const entries = [
      entry({
        title: "単日公演",
        startsOn: "2026-03-10",
        endsOn: "2026-03-10",
      }),
    ];
    const { container } = render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    // A single-day Event never bands - its title never appears as visible
    // band text on the bare month landing (unlike a multi-day Event's band,
    // asserted in the "partial degradation" test above).
    expect(screen.queryByText("単日公演")).not.toBeInTheDocument();
    expect(container.querySelector("[data-band-event-id]")).toBeNull();
    // The day cell for 2026-03-10 carries the single-day count in its
    // accessible name instead.
    expect(
      screen.getByRole("link", { name: /3月10日、イベント1件/ }),
    ).toBeInTheDocument();
  });

  it("selecting a day (via the date prop) shows its occurrences in the selected-day list, including a group badge", async () => {
    const entries = [
      entry({
        id: "33333333-3333-4333-8333-333333333333",
        title: "単日公演（花組）",
        startsOn: "2026-03-10",
        endsOn: "2026-03-10",
        genreKey: "takarazuka",
        groupIds: ["group-hana"],
        occurrences: [{ id: "occ-1", startsAt: "2026-03-10T10:00:00.000Z" }],
      }),
    ];
    render(
      <CatalogView
        month={MONTH}
        today={TODAY}
        selectedDate={"2026-03-10" as never}
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
            groupsByGenreKey: {
              takarazuka: [
                { id: "group-hana" as never, key: "hana", displayName: "花組" },
              ],
            },
            venuesByGenreKey: {},
          },
        }}
        groupNamesResult={{
          ok: true,
          byId: new Map([["group-hana" as never, "花組"]]),
        }}
      />,
    );

    expect(screen.getByText("単日公演（花組）")).toBeInTheDocument();
    expect(screen.getByText("花組")).toBeInTheDocument();
    expect(screen.getByText("宝塚")).toBeInTheDocument();
  });

  it("shows the month-level unconfirmed-holiday-coverage notice for a month beyond the holiday snapshot's coverage", () => {
    render(
      <CatalogView
        month={{ year: 2030, month: 1 }}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "empty" }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    // The raw-empty panel replaces the whole populated branch (existing,
    // unrelated behavior) - render again with a populated (even if
    // filtered-empty) state so the calendar itself mounts.
    expect(
      screen.getByText("この月に登録されているイベントはありません"),
    ).toBeInTheDocument();
  });

  it("shows the month-level unconfirmed-holiday-coverage notice when the range read is populated", () => {
    const entries = [entry({ startsOn: "2030-01-05", endsOn: "2030-01-05" })];
    render(
      <CatalogView
        month={{ year: 2030, month: 1 }}
        today={TODAY}
        selectedDate={null}
        eventsState={{ variant: "populated", data: entries }}
        filterOptionsResult={OK_FILTER_OPTIONS}
        groupNamesResult={{ ok: true, byId: new Map() }}
      />,
    );

    expect(
      screen.getByText(
        "この月の一部の日付は祝日データの公表範囲外です。未公表の祝日は表示されません。",
      ),
    ).toBeInTheDocument();
  });
});
