'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/ui/Button';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import {
  buildMonthCalendarViewModel,
  selectDayOccurrences,
  selectEventLevelFallback,
} from '@/domain/calendarMonth.ts';
import {
  catalogFilterOptionUniverseForGenre,
  classificationsByEventId,
  filterCatalogEvents,
} from '@/domain/catalogFilterIntegration.ts';
import {
  EMPTY_CATALOG_FILTER_STATE,
  toCatalogFilterSelection,
} from '@/domain/catalogFilterSheet.ts';
import type { CatalogParams } from '@/domain/catalogNavigation.ts';
import type {
  CatalogFilterSelection,
  EventClassification,
  EventWithOccurrences,
} from '@/domain/eventCatalog.ts';
import type { CatalogFilterData } from '../_lib/catalogFilterData.ts';
import { EventLevelFallbackList } from './EventLevelFallbackList.tsx';
import { FilterSheet } from './FilterSheet.tsx';
import { MonthCalendar } from './MonthCalendar.tsx';
import { SelectedDayList } from './SelectedDayList.tsx';
import styles from './CatalogView.module.css';

export interface CatalogViewProps {
  yearMonth: string;
  selectedDate: string | null;
  todayDate: string;
  /** The already-fetched, *unfiltered* range read (listEventCatalogInRange) -
   * this component is the only place that ever calls filterCatalogEvents on
   * it, so every rendered surface below shares one filtered result. */
  events: readonly EventWithOccurrences[];
  /** True when the unfiltered range read itself came back with no events at
   * all (independent of any filter selection) - drives the existing
   * month-landing empty state, unrelated to "filter matched zero events". */
  isEmptyRange: boolean;
  /** Pre-rendered server subtree (creator-only "+ 追加" / "招待一覧") - this
   * component has no opinion on catalog write permissions, it only places
   * this between the heading row and the filter-unavailable notice/body,
   * same position it held in page.tsx before Issue #145. */
  actionRow: ReactNode;
  context: CatalogParams;
  filterData: CatalogFilterData;
}

function FilterIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 5.5h14M6 10h8M8.5 14.5h3" />
    </svg>
  );
}

const EMPTY_SELECTION = toCatalogFilterSelection(EMPTY_CATALOG_FILTER_STATE);

/**
 * Client-side integration boundary the Issue #145 canonical addendum
 * describes: composes #147's `FilterSheet` (browser-local persistence,
 * draft/apply, stale-option pruning all owned there) with #167's
 * `matchesCatalogFilter`-based filtering (via domain/catalogFilterIntegration.ts)
 * against the server-fetched Event/Occurrence range read, and hands the same
 * filtered set to MonthCalendar/EventLevelFallbackList/SelectedDayList so
 * none of the three can ever disagree about which Events are in view.
 *
 * `selectionReady` stays false until FilterSheet's own mount-restore effect
 * has actually reported the current applied selection (its
 * `onAppliedSelectionChange` fires once on mount either way, restored or
 * not) - the calendar/list body renders nothing but a small
 * LoadingIndicator until then, rather than briefly showing an unfiltered
 * result that a saved filter is about to override (the addendum's "SSRで
 * unfiltered -> 一瞬表示 -> hydration後に突然filtered" failure mode). When
 * `filterData` itself is unavailable there is nothing to restore, so the
 * unfiltered set renders immediately instead - the bounded degradation the
 * Issue body calls for, with a StatePanel making the degradation explicit
 * rather than a silently-empty/silently-unfiltered result.
 */
export function CatalogView({
  yearMonth,
  selectedDate,
  todayDate,
  events,
  isEmptyRange,
  actionRow,
  context,
  filterData,
}: CatalogViewProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [appliedSelection, setAppliedSelection] = useState<CatalogFilterSelection>(EMPTY_SELECTION);

  const handleAppliedSelectionChange = useCallback((selection: CatalogFilterSelection) => {
    setAppliedSelection(selection);
    setSelectionReady(true);
  }, []);

  const classificationByEventId = useMemo<ReadonlyMap<string, EventClassification>>(
    () => (filterData.ok ? classificationsByEventId(filterData.classifications) : new Map()),
    [filterData],
  );

  const optionUniverse = useMemo(
    () =>
      filterData.ok
        ? catalogFilterOptionUniverseForGenre(
            appliedSelection.genre,
            filterData.groupOptionsByGenreKey,
            filterData.venueOptionsByGenreKey,
          )
        : { groupKeys: [], venues: [] },
    [filterData, appliedSelection.genre],
  );

  const filteredEvents = useMemo(
    () =>
      filterData.ok
        ? filterCatalogEvents(events, classificationByEventId, appliedSelection, optionUniverse)
        : events,
    [events, filterData, classificationByEventId, appliedSelection, optionUniverse],
  );

  // すべて/hidden-facet leakage guard: a genre other than すべて is itself a
  // filter (#158), so this is the only condition the dot/label ever needs -
  // FilterSheet's own contract already narrows appliedSelection to the
  // currently-visible facet only (see its onAppliedSelectionChange doc
  // comment), so a remembered-but-not-currently-shown secondary selection
  // for a different genre can never surface here.
  const isFilterActive = filterData.ok && selectionReady && appliedSelection.genre !== null;
  const canOpenSheet = filterData.ok;
  // Nothing to restore when filter data itself never loaded - the unfiltered
  // body is the whole story in that branch, immediately. Likewise, when the
  // raw range read itself is empty (`isEmptyRange`), filtering an empty set
  // can never produce a different result under any possible selection - the
  // "flash of wrong content" the addendum guards against has no content to
  // be wrong about, so this case also renders immediately rather than
  // waiting on a restore that cannot change the outcome.
  const readyToRenderBody = !filterData.ok || selectionReady || isEmptyRange;

  return (
    <>
      {/* Invisible, presentation-free hook so a real-browser check (manual
          375px sanity, or an automated one) can poll for "the calendar/list
          body has actually resolved" without guessing at a network-idle
          timeout - see readyToRenderBody above for what this reflects. Never
          read by application code itself. */}
      <span aria-hidden="true" hidden data-catalog-ready={readyToRenderBody ? 'true' : 'false'} />
      <div className={styles.headingRow}>
        <PageHeading>イベント</PageHeading>
        <span className={styles.filterButtonWrap}>
          <Button
            variant="icon"
            aria-label={isFilterActive ? '絞り込み（適用中）' : '絞り込み'}
            aria-haspopup={canOpenSheet ? 'dialog' : undefined}
            aria-disabled={canOpenSheet ? undefined : true}
            onClick={
              canOpenSheet
                ? () => {
                    setSheetOpen(true);
                  }
                : undefined
            }
          >
            <FilterIcon />
            {isFilterActive ? <span aria-hidden="true" className={styles.activeDot} /> : null}
          </Button>
        </span>
      </div>

      {actionRow}

      {!filterData.ok ? (
        <StatePanel
          variant="unavailable"
          title="絞り込みを利用できません"
          description="通信状況を確認し、もう一度お試しください。イベント一覧の閲覧は引き続き行えます。"
        />
      ) : null}

      {filterData.ok ? (
        <FilterSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          genres={filterData.genres}
          groupOptionsByGenreKey={filterData.groupOptionsByGenreKey}
          venueOptionsByGenreKey={filterData.venueOptionsByGenreKey}
          onAppliedSelectionChange={handleAppliedSelectionChange}
        />
      ) : null}

      {readyToRenderBody ? (
        <>
          <MonthCalendar
            viewModel={buildMonthCalendarViewModel(yearMonth, filteredEvents)}
            selectedDate={selectedDate}
            todayDate={todayDate}
          />

          {isEmptyRange && selectedDate === null ? (
            <StatePanel variant="empty" title="この月に登録されている公演はありません" />
          ) : null}

          {/* Issue #172 root cause C (Claude C2): the raw-range-empty
              StatePanel above only fires when the *unfiltered* month has no
              Events at all. An applied filter that reduces a non-empty raw
              month to zero results is a distinct situation - reuses the
              same `filteredEvents` this component already computes (no
              second filter predicate), gated so it never conflates with, or
              fires alongside, the raw-empty message above. */}
          {!isEmptyRange &&
          selectedDate === null &&
          isFilterActive &&
          filteredEvents.length === 0 ? (
            <StatePanel variant="empty" title="選択した条件に一致するイベントはありません" />
          ) : null}

          {selectedDate !== null ? (
            <>
              <EventLevelFallbackList
                events={selectEventLevelFallback(filteredEvents, selectedDate)}
                context={context}
                classificationByEventId={classificationByEventId}
              />
              <SelectedDayList
                date={selectedDate}
                occurrences={selectDayOccurrences(filteredEvents, selectedDate)}
                context={context}
                classificationByEventId={classificationByEventId}
              />
            </>
          ) : null}
        </>
      ) : (
        <div className={styles.loading}>
          <LoadingIndicator label="絞り込みを準備中" />
        </div>
      )}
    </>
  );
}
