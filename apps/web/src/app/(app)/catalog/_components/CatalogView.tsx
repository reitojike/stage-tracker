"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, StatePanel } from "@stage-tracker/ui";
import type { EventCatalogEntry } from "@/lib/data";
import {
  addMonths,
  formatMonthParam,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import { formatMonthJa } from "@/app/_lib/format";
import type { BlockState } from "@/app/_lib/read-state";
import {
  DEFAULT_CATALOG_FILTER_SELECTION,
  activeFacetForGenre,
  filterCatalogEntries,
  isCatalogFilterSelectionActive,
  type CatalogFilterOptions,
  type CatalogFilterSelection,
} from "../_lib/catalog-filters";
import type { CatalogFilterOptionsResult } from "../_lib/catalog-loader";

const FILTER_STORAGE_KEY = "stage-tracker:catalog-filter:v1";

/**
 * AGENTS.md「Gate Aの canonical genre identity」の3件。永久 closed world では
 * ないが（同節参照）、この Gate A 実装は known な3件だけを選択肢として示す -
 * 将来 genre が increaseした場合は `filterOptionsResult.options.genres`
 * （catalog全体の known values、AGENTS.md「Filter option universe」）を
 * そのまま列挙する形に変えられる。ここでは genre の表示順・ラベルを
 * 固定するために、読み込んだ genre 行のうち Gate A の3件のみ使う。
 */
const GENRE_LABELS_JA: Readonly<Record<string, string>> = {
  takarazuka: "宝塚",
  kabuki: "歌舞伎",
  idol: "アイドル",
};

function readStoredSelection(): CatalogFilterSelection | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "genreKey" in parsed &&
      "groupIds" in parsed &&
      "venues" in parsed
    ) {
      return parsed as CatalogFilterSelection;
    }
    return null;
  } catch {
    return null;
  }
}

function storeSelection(selection: CatalogFilterSelection): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // localStorage が使えない環境（プライベートブラウジングの容量制限等）
    // では黙って諦める - フィルタは client-local な利便性機能であり、
    // 永続化できないことを画面のエラーにはしない。
  }
}

export interface CatalogViewProps {
  readonly month: TokyoYearMonth;
  readonly eventsState: BlockState<readonly EventCatalogEntry[]>;
  readonly filterOptionsResult: CatalogFilterOptionsResult;
}

/**
 * `/catalog`'s presentational + interactive layer
 * (`docs/v2/oracle-routes-ui.md` §2 「イベントカタログ一覧」). A Client
 * Component because filter selection is held client-local and persisted to
 * `localStorage` (AGENTS.md "Filter persistence": "browser-local
 * persistenceで十分" - no server round-trip, no user preference row).
 *
 * Simplification versus the oracle's legacy `FilterSheet` (documented in
 * this Task's report): this renders the filter controls as an inline
 * expand/collapse panel rather than a native `<dialog>` bottom sheet -
 * `packages/ui` does not yet have a `Sheet` primitive (only `StatePanel`/
 * `AppShell`/`AppBar`/`PrimaryNav`/`Badge`/`Button` are implemented so far),
 * and adding one is out of this Task's scope. The applied/draft distinction
 * and localStorage persistence are preserved; only the modal presentation
 * is simplified.
 */
export function CatalogView({
  month,
  eventsState,
  filterOptionsResult,
}: CatalogViewProps) {
  // Lazy initializers (not a `useEffect`) so `localStorage` is read exactly
  // once, on mount, with no synchronous `setState`-in-effect call (this is
  // a plain client-only preference read, not "synchronizing with an
  // external system" that changes over the component's lifetime -
  // `readStoredSelection()` itself is a no-op on the server, where
  // `window` is undefined, so SSR always renders the default selection;
  // a returning visitor with a saved selection may see a 1-frame hydration
  // adjustment to their stored filter, an accepted trade-off for a
  // browser-local convenience feature per AGENTS.md "Filter persistence").
  const [applied, setApplied] = useState<CatalogFilterSelection>(
    () => readStoredSelection() ?? DEFAULT_CATALOG_FILTER_SELECTION,
  );
  const [draft, setDraft] = useState<CatalogFilterSelection>(
    () => readStoredSelection() ?? DEFAULT_CATALOG_FILTER_SELECTION,
  );
  const [panelOpen, setPanelOpen] = useState(false);

  const filteredEntries = useMemo(() => {
    const rawEntries =
      eventsState.variant === "populated" ? eventsState.data : [];
    if (!filterOptionsResult.ok) {
      return rawEntries;
    }
    return filterCatalogEntries(
      rawEntries,
      applied,
      filterOptionsResult.options,
    );
  }, [eventsState, applied, filterOptionsResult]);

  function applyDraft() {
    setApplied(draft);
    storeSelection(draft);
    setPanelOpen(false);
  }

  function resetFilter() {
    setApplied(DEFAULT_CATALOG_FILTER_SELECTION);
    setDraft(DEFAULT_CATALOG_FILTER_SELECTION);
    storeSelection(DEFAULT_CATALOG_FILTER_SELECTION);
    setPanelOpen(false);
  }

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">
        イベントカタログ
      </h1>

      <div className="flex items-center justify-between">
        <Link
          href={`/catalog?month=${formatMonthParam(addMonths(month, -1))}`}
          className="text-body-sm text-primary"
        >
          ‹ 前の月
        </Link>
        <span className="text-title font-semibold text-foreground">
          {formatMonthJa(formatMonthParam(month))}
        </span>
        <Link
          href={`/catalog?month=${formatMonthParam(addMonths(month, 1))}`}
          className="text-body-sm text-primary"
        >
          次の月 ›
        </Link>
      </div>

      {eventsState.variant !== "populated" ? (
        <StatePanel
          variant={eventsState.variant}
          title={
            eventsState.variant === "empty"
              ? "この月に登録されているイベントはありません"
              : eventsState.variant === "unavailable"
                ? "カタログを確認できません"
                : "カタログを読み込めませんでした"
          }
          description={
            eventsState.variant === "empty" ? "" : eventsState.message
          }
          action={
            eventsState.variant === "error" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                再読み込み
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-sm">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPanelOpen((open) => !open)}
            >
              絞り込み{isCatalogFilterSelectionActive(applied) ? "中" : ""}
            </Button>
            {isCatalogFilterSelectionActive(applied) ? (
              <button
                type="button"
                onClick={resetFilter}
                className="text-body-sm text-primary underline-offset-4 hover:underline"
              >
                条件を解除する
              </button>
            ) : null}
          </div>

          {!filterOptionsResult.ok ? (
            <StatePanel
              variant={filterOptionsResult.variant}
              title="絞り込みを利用できません"
              description={filterOptionsResult.message}
            />
          ) : null}

          {panelOpen && filterOptionsResult.ok ? (
            <FilterPanel
              options={filterOptionsResult.options}
              draft={draft}
              onChange={setDraft}
              onApply={applyDraft}
            />
          ) : null}

          {filteredEntries.length === 0 ? (
            <StatePanel
              variant="empty"
              title="条件に合うイベントがありません"
              action={
                <button
                  type="button"
                  onClick={resetFilter}
                  className="text-body-sm font-medium text-primary"
                >
                  条件を解除する
                </button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-sm">
              {filteredEntries.map((entry) => (
                <li key={entry.event.id}>
                  <EventCatalogRow entry={entry} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EventCatalogRow({ entry }: { readonly entry: EventCatalogEntry }) {
  return (
    <Link
      href={`/catalog/events/${entry.event.id}`}
      className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
    >
      <span className="flex items-center gap-xs">
        {entry.classification.genre !== null ? (
          <Badge variant="outline">
            {entry.classification.genre.displayName}
          </Badge>
        ) : null}
        {entry.event.canceledAt !== null ? (
          <Badge variant="terminal">中止</Badge>
        ) : null}
      </span>
      <span className="text-title font-medium text-foreground">
        {entry.event.title}
      </span>
      <span className="text-body-sm text-muted-foreground">
        {entry.event.startsOn === entry.event.endsOn
          ? entry.event.startsOn
          : `${entry.event.startsOn} 〜 ${entry.event.endsOn}`}
        {entry.event.venue !== null ? ` ・ ${entry.event.venue}` : ""}
      </span>
      {entry.occurrences.length === 0 ? (
        <span className="text-caption text-muted-foreground">
          公演回はまだ発表されていません
        </span>
      ) : null}
    </Link>
  );
}

function FilterPanel({
  options,
  draft,
  onChange,
  onApply,
}: {
  readonly options: CatalogFilterOptions;
  readonly draft: CatalogFilterSelection;
  readonly onChange: (next: CatalogFilterSelection) => void;
  readonly onApply: () => void;
}) {
  const facet = activeFacetForGenre(draft.genreKey);
  const knownGenreKeys = Object.keys(GENRE_LABELS_JA).filter((key) =>
    options.genres.some((genre) => genre.key === key),
  );

  function setGenre(genreKey: string | null) {
    onChange({ genreKey, groupIds: [], venues: [] });
  }

  function toggleGroup(id: CatalogFilterSelection["groupIds"][number]) {
    const has = draft.groupIds.includes(id);
    onChange({
      ...draft,
      groupIds: has
        ? draft.groupIds.filter((existing) => existing !== id)
        : [...draft.groupIds, id],
    });
  }

  function toggleVenue(venue: string) {
    const has = draft.venues.includes(venue);
    onChange({
      ...draft,
      venues: has
        ? draft.venues.filter((existing) => existing !== venue)
        : [...draft.venues, venue],
    });
  }

  return (
    <div className="flex flex-col gap-md rounded-control border border-border bg-card p-md">
      <fieldset className="flex flex-col gap-xs">
        <legend className="text-label font-semibold text-foreground">
          ジャンル
        </legend>
        <div className="flex flex-wrap gap-xs">
          <label className="flex items-center gap-2xs text-body-sm">
            <input
              type="radio"
              name="catalog-genre"
              checked={draft.genreKey === null}
              onChange={() => setGenre(null)}
            />
            すべて
          </label>
          {knownGenreKeys.map((key) => (
            <label key={key} className="flex items-center gap-2xs text-body-sm">
              <input
                type="radio"
                name="catalog-genre"
                checked={draft.genreKey === key}
                onChange={() => setGenre(key)}
              />
              {GENRE_LABELS_JA[key]}
            </label>
          ))}
        </div>
      </fieldset>

      {facet === "group" ? (
        <fieldset className="flex flex-col gap-xs">
          <legend className="text-label font-semibold text-foreground">
            {draft.genreKey === "idol" ? "グループ" : "組"}
          </legend>
          <div className="flex flex-wrap gap-xs">
            {options.groups.map((group) => (
              <label
                key={group.id}
                className="flex items-center gap-2xs text-body-sm"
              >
                <input
                  type="checkbox"
                  checked={draft.groupIds.includes(group.id)}
                  onChange={() => toggleGroup(group.id)}
                />
                {group.displayName}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {facet === "venue" ? (
        <fieldset className="flex flex-col gap-xs">
          <legend className="text-label font-semibold text-foreground">
            会場
          </legend>
          <div className="flex flex-wrap gap-xs">
            {options.venues.map((venue) => (
              <label
                key={venue}
                className="flex items-center gap-2xs text-body-sm"
              >
                <input
                  type="checkbox"
                  checked={draft.venues.includes(venue)}
                  onChange={() => toggleVenue(venue)}
                />
                {venue}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <Button onClick={onApply} className="self-start">
        この条件で絞り込む
      </Button>
    </div>
  );
}
