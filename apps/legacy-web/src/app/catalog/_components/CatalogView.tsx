'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
  catalogFilterSummary,
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
import { FilterSheet, type FilterSheetHandle } from './FilterSheet.tsx';
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
 * Client-side boundary between the server-fetched Event/Occurrence range and
 * interactive filtering. FilterSheet owns persisted selection, draft/apply
 * state, and stale-option pruning; this component applies the domain filter
 * to the fetched set and passes that same filtered collection to
 * MonthCalendar, EventLevelFallbackList, and SelectedDayList so every surface
 * agrees on which Events are in view.
 *
 * `selectionReady` stays false until FilterSheet reports the applied selection
 * restored on mount (including the no-selection case). The calendar/list body
 * therefore avoids exposing an unfiltered result before a saved selection can
 * be applied. If filter metadata is unavailable, there is no selection to
 * restore: the unfiltered range remains visible immediately and the explicit
 * StatePanel communicates that filtering is unavailable.
 */
export function CatalogView({
  yearMonth,
  selectedDate,
  todayDate,
  events,
  isEmptyRange,
  context,
  filterData,
}: CatalogViewProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [appliedSelection, setAppliedSelection] = useState<CatalogFilterSelection>(EMPTY_SELECTION);
  const filterSheetRef = useRef<FilterSheetHandle>(null);

  const handleAppliedSelectionChange = useCallback((selection: CatalogFilterSelection) => {
    setAppliedSelection(selection);
    setSelectionReady(true);
  }, []);

  // Both clear affordances delegate to FilterSheet's imperative `clear()` so
  // applied/draft state and browser persistence have one owner.
  const handleClearFilter = useCallback(() => {
    filterSheetRef.current?.clear();
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

  // A non-null genre is the active-filter signal. FilterSheet keeps secondary
  // selections scoped to the currently visible facet, so a remembered option
  // for another genre cannot leak into this indicator or the domain filter.
  const isFilterActive = filterData.ok && selectionReady && appliedSelection.genre !== null;
  // The summary follows applied state only, never the in-sheet draft.
  // `onAppliedSelectionChange` reports the restored or confirmed selection,
  // not edits that have not been applied yet.
  const filterSummary = useMemo(
    () =>
      filterData.ok
        ? catalogFilterSummary(
            appliedSelection,
            filterData.genres,
            filterData.groupOptionsByGenreKey,
            filterData.venueOptionsByGenreKey,
          )
        : null,
    [filterData, appliedSelection],
  );
  const canOpenSheet = filterData.ok;
  // If filter metadata is unavailable, the unfiltered body is the only
  // available result and can render immediately. A genuinely empty raw range
  // also cannot change under any selection, so it does not need to wait for a
  // restore that cannot affect the rendered body.
  const readyToRenderBody = !filterData.ok || selectionReady || isEmptyRange;
  // Distinguish a non-empty raw range that becomes empty after an applied
  // filter from a month that had no source Events. Reuse the same
  // `filteredEvents` projection and keep this state independent of
  // `selectedDate`, so filtered-zero feedback is not hidden by day selection.
  const isFilteredZero = !isEmptyRange && isFilterActive && filteredEvents.length === 0;

  return (
    <>
      {/* Invisible, presentation-free hook so a real-browser check (manual
          375px sanity, or an automated one) can poll for "the calendar/list
          body has actually resolved" without guessing at a network-idle
          timeout - see readyToRenderBody above for what this reflects. Never
          read by application code itself. */}
      <span aria-hidden="true" hidden data-catalog-ready={readyToRenderBody ? 'true' : 'false'} />
      <div className={styles.headingRow}>
        <PageHeading className={styles.main}>イベント</PageHeading>
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

      {/* Show the summary only for an applied filter. It follows
          `appliedSelection`/`filterSummary`, never an unconfirmed draft, and
          does not reserve space while filtering is inactive. */}
      {isFilterActive && filterSummary !== null ? (
        <div className={styles.summaryRow}>
          <p className={styles.summaryText}>
            絞り込み中: <span className={styles.summaryGenre}>{filterSummary.genreLabel}</span>
            {filterSummary.lowerLabel !== null ? (
              <span className={styles.summaryLower}> / {filterSummary.lowerLabel}</span>
            ) : null}
          </p>
          <button
            type="button"
            className={styles.summaryClear}
            aria-label="絞り込みを解除"
            onClick={handleClearFilter}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      {!filterData.ok ? (
        <StatePanel
          variant="unavailable"
          title="絞り込みを利用できません"
          description="通信状況を確認し、もう一度お試しください。イベント一覧の閲覧は引き続き行えます。"
        />
      ) : null}

      {filterData.ok ? (
        <FilterSheet
          ref={filterSheetRef}
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
            <StatePanel variant="empty" title="この月に登録されているイベントはありません" />
          ) : null}

          {/* A non-empty raw month that becomes empty after filtering needs
              distinct feedback and a clear action. Reuse `filteredEvents` and
              `handleClearFilter` so the message cannot drift from the applied
              filter or the summary row, and keep it visible regardless of
              whether a day is selected. */}
          {isFilteredZero ? (
            <StatePanel
              variant="empty"
              title="条件に合うイベントがありません"
              action={
                <Button type="button" variant="secondary" onClick={handleClearFilter}>
                  条件を解除する
                </Button>
              }
            />
          ) : null}

          {selectedDate !== null && !isFilteredZero ? (
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
