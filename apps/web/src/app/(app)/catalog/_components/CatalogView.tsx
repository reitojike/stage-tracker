"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import type {
  EventClassification,
  TokyoCalendarDate,
} from "@stage-tracker/domain";
import { Button, StatePanel } from "@stage-tracker/ui";
import type { EventCatalogEntry } from "@/lib/data";
import {
  addMonths,
  formatMonthParam,
  type TokyoYearMonth,
} from "@/app/_lib/calendar-grid";
import { formatMonthJa } from "@/app/_lib/format";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type BlockState,
} from "@/app/_lib/read-state";
import {
  DEFAULT_CATALOG_FILTER_SELECTION,
  activeFacetForGenre,
  filterCatalogEntries,
  isCatalogFilterSelectionActive,
  type CatalogFilterOptions,
  type CatalogFilterSelection,
} from "../_lib/catalog-filters";
import type {
  CatalogFilterOptionsResult,
  CatalogGroupNamesResult,
} from "../_lib/catalog-loader";
import {
  buildCatalogMonthViewModel,
  selectDayOccurrences,
  selectEventLevelFallback,
} from "../_lib/calendar-view-model";
import { catalogMonthHref } from "../_lib/catalog-links";
import { MonthCalendar } from "./MonthCalendar";
import { SelectedDayList } from "./SelectedDayList";

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

/**
 * `useSyncExternalStore` の client snapshot。React は render のたびに
 * `getSnapshot` を呼ぶため、保存値が変わっていないのに毎回新しい object を
 * 返すと無限ループとして扱われる。raw 文字列をキーに cache して同一参照を返す。
 */
let cachedRaw: string | null | undefined;
let cachedSelection: CatalogFilterSelection = DEFAULT_CATALOG_FILTER_SELECTION;

function getStoredSelectionSnapshot(): CatalogFilterSelection {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSelection = readStoredSelection() ?? DEFAULT_CATALOG_FILTER_SELECTION;
  }
  return cachedSelection;
}

/**
 * server snapshot。React は hydration の初回 render でも**こちら**を使い、
 * hydration 完了後に `getStoredSelectionSnapshot` へ切り替える。これが
 * `useSyncExternalStore` を使う理由そのもので、初回 client render は必ず
 * server render と一致する。
 */
function getServerStoredSelectionSnapshot(): CatalogFilterSelection {
  return DEFAULT_CATALOG_FILTER_SELECTION;
}

function subscribeStoredSelection(onStoreChange: () => void): () => void {
  // 他タブでの変更のみを購読する。同一タブの変更は storeSelection を呼ぶ側が
  // そのまま state を更新するので、ここで再通知する必要はない。
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
  };
}

export interface CatalogViewProps {
  readonly month: TokyoYearMonth;
  readonly today: TokyoCalendarDate;
  /** `null` = 月ランディング（未選択）。`docs/v2/oracle-domain.md` §2.10。 */
  readonly selectedDate: TokyoCalendarDate | null;
  readonly eventsState: BlockState<readonly EventCatalogEntry[]>;
  readonly filterOptionsResult: CatalogFilterOptionsResult;
  /** `page.tsx`'s `loadCatalogEntryGroupNames` - genre に一切スコープせず
   * `eventsState`が実際に持つ `classification.groupIds` から直接解決した
   * もの（codex review 指摘の修正: facet 非対象 genre の group が
   * `filterOptionsResult` 経由では欠落する問題）。読み取り失敗時は
   * `filterOptionsResult` と同じく `ok: false` を返し、空 Map へ潰さない
   * （codex review 指摘: 「group なし」と読み取り失敗の区別）。 */
  readonly groupNamesResult: CatalogGroupNamesResult;
}

/**
 * `/catalog`'s presentational + interactive layer
 * (`docs/v2/oracle-routes-ui.md` §2 「イベントカタログ一覧」,
 * `docs/v2/oracle-domain.md` §2.9/§2.10). A Client Component because filter
 * selection is held client-local and persisted to `localStorage`
 * (AGENTS.md "Filter persistence": "browser-local persistenceで十分" - no
 * server round-trip, no user preference row).
 *
 * Renders the month calendar grid (`MonthCalendar`) + selected-day list
 * (`SelectedDayList`) - this Task's confirmed-gap fix, replacing this
 * component's previous flat `<ul>` of every event in the raw range. Legacy's
 * own `CatalogView.tsx` (the oracle) never renders such a flat landing list
 * either: full per-event detail (genre/group/venue/cancellation badges) is
 * reached by selecting a day, exactly mirrored here - see this Task's report
 * for why the flat list is removed rather than kept alongside the calendar.
 *
 * Simplification versus the oracle's legacy `FilterSheet` (documented in a
 * prior Task's report, unchanged by this Task): this renders the filter
 * controls as an inline expand/collapse panel rather than a native
 * `<dialog>` bottom sheet - `packages/ui` does not yet have a `Sheet`
 * primitive. The applied/draft distinction and localStorage persistence are
 * preserved; only the modal presentation is simplified.
 */
export function CatalogView({
  month,
  today,
  selectedDate,
  eventsState,
  filterOptionsResult,
  groupNamesResult,
}: CatalogViewProps) {
  // 保存済みフィルタは `useSyncExternalStore` で読む。以前は lazy な
  // `useState(() => readStoredSelection() ?? ...)` だったが、これは server
  // pass（`window` 無し -> default）と client の**初回** render pass
  // （`window` 有り -> 保存値）で結果が変わる。初回 client render は
  // hydration そのもので effect より前に走るため、保存値を持つ再訪ユーザーには
  // 1 フレームの見た目調整ではなく本当の hydration mismatch が起きていた
  // （React が server/client の markup 不一致を検出して subtree を作り直す）。
  //
  // `useSyncExternalStore` は hydration 中は server snapshot を使い、完了後に
  // client snapshot へ切り替えるので、この不一致が構造的に起きない。
  // effect 内での同期 setState（cascading render を招く）も避けられる。
  const storedSelection = useSyncExternalStore(
    subscribeStoredSelection,
    getStoredSelectionSnapshot,
    getServerStoredSelectionSnapshot,
  );

  // ユーザーがこの画面で操作するまでは保存値（hydration 前は default）を使う。
  // null = 「まだこの画面で操作していない」。
  const [userApplied, setUserApplied] = useState<CatalogFilterSelection | null>(
    null,
  );
  const [userDraft, setUserDraft] = useState<CatalogFilterSelection | null>(
    null,
  );
  const applied = userApplied ?? storedSelection;
  const draft = userDraft ?? storedSelection;
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

  // event id -> classification, for MonthCalendar/SelectedDayList's badges -
  // derived from the same `filteredEntries` every rendered surface shares,
  // so a filtered-out event's classification never leaks into a still-visible
  // one's lookup.
  const classificationByEventId = useMemo(
    () =>
      new Map<string, EventClassification>(
        filteredEntries.map((entry) => [entry.event.id, entry.classification]),
      ),
    [filteredEntries],
  );

  // group id -> displayName は `page.tsx` から prop で渡される
  // (`loadCatalogEntryGroupNames` - genre facet の有無に依存しない解決に
  // codex review 指摘で変更済み)。

  const viewModel = useMemo(
    () => buildCatalogMonthViewModel(month, filteredEntries),
    [month, filteredEntries],
  );

  function applyDraft() {
    setUserApplied(draft);
    storeSelection(draft);
    setPanelOpen(false);
  }

  function resetFilter() {
    setUserApplied(DEFAULT_CATALOG_FILTER_SELECTION);
    setUserDraft(DEFAULT_CATALOG_FILTER_SELECTION);
    storeSelection(DEFAULT_CATALOG_FILTER_SELECTION);
    setPanelOpen(false);
  }

  // `empty`（raw range に Event が0件）は legacy と同じく「一覧は正常に
  // 空」という正当な状態として扱い、`unavailable`/`error` とは区別する
  // （codex/ChatGPT review 指摘: 従来は3つとも同じ StatePanel-only 分岐へ
  // 潰しており、空月ではカレンダー自体・絞り込みUI・選択日一覧まで消えて
  // いた。legacy の `CatalogView.tsx` は `isEmptyRange` を「カレンダーは
  // 描画するが月レベルの空メッセージを追加する」フラグとしてのみ使う -
  // `apps/legacy-web/src/app/catalog/page.tsx`「A failed catalog read
  // leaves nothing to filter」コメント参照）。
  const isRawEmpty = eventsState.variant === "empty";
  // legacy の `isFilteredZero` 定義そのまま: raw range が既に空の場合は
  // （上の月レベル空メッセージと二重にならないよう）除外し、絞り込みが
  // 実際に適用されている場合のみ「条件に合うイベントがありません」を出す。
  const isFilteredZero =
    !isRawEmpty &&
    isCatalogFilterSelectionActive(applied) &&
    filteredEntries.length === 0;

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">
        イベントカタログ
      </h1>

      <div className="flex items-center justify-between">
        <Link
          href={catalogMonthHref(addMonths(month, -1))}
          className="text-body-sm text-primary"
        >
          ‹ 前の月
        </Link>
        <span className="text-title font-semibold text-foreground">
          {formatMonthJa(formatMonthParam(month))}
        </span>
        <Link
          href={catalogMonthHref(addMonths(month, 1))}
          className="text-body-sm text-primary"
        >
          次の月 ›
        </Link>
      </div>

      {eventsState.variant === "unavailable" ||
      eventsState.variant === "error" ? (
        <StatePanel
          variant={eventsState.variant}
          title={
            eventsState.variant === "unavailable"
              ? "カタログを確認できません"
              : "カタログを読み込めませんでした"
          }
          {...(eventsState.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
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
              {...(filterOptionsResult.variant === "error"
                ? { description: READ_FAILURE_RETRY_HINT_JA }
                : {})}
            />
          ) : null}

          {panelOpen && filterOptionsResult.ok ? (
            <FilterPanel
              options={filterOptionsResult.options}
              draft={draft}
              onChange={setUserDraft}
              onApply={applyDraft}
            />
          ) : null}

          <MonthCalendar
            viewModel={viewModel}
            selectedDate={selectedDate}
            today={today}
          />

          {isRawEmpty && selectedDate === null ? (
            <StatePanel
              variant="empty"
              title="この月に登録されているイベントはありません"
            />
          ) : null}

          {isFilteredZero ? (
            <StatePanel
              variant="empty"
              title="条件に合うイベントがありません"
              action={
                <Button type="button" variant="secondary" onClick={resetFilter}>
                  条件を解除する
                </Button>
              }
            />
          ) : null}

          {selectedDate !== null && !isFilteredZero ? (
            <>
              {!groupNamesResult.ok ? (
                <StatePanel
                  variant={groupNamesResult.variant}
                  title="組・グループの表示名を取得できませんでした"
                  {...(groupNamesResult.variant === "error"
                    ? { description: READ_FAILURE_RETRY_HINT_JA }
                    : {})}
                />
              ) : null}
              <SelectedDayList
                date={selectedDate}
                month={month}
                occurrences={selectDayOccurrences(
                  filteredEntries,
                  selectedDate,
                )}
                fallbackEntries={selectEventLevelFallback(
                  filteredEntries,
                  selectedDate,
                )}
                classificationByEventId={classificationByEventId}
                groupNameById={
                  groupNamesResult.ok ? groupNamesResult.byId : new Map()
                }
              />
            </>
          ) : null}
        </>
      )}
    </div>
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
  const groupOptions =
    draft.genreKey !== null
      ? (options.groupsByGenreKey[draft.genreKey] ?? [])
      : [];
  const venueOptions =
    draft.genreKey !== null
      ? (options.venuesByGenreKey[draft.genreKey] ?? [])
      : [];

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
            {groupOptions.map((group) => (
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
            {venueOptions.map((venue) => (
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
