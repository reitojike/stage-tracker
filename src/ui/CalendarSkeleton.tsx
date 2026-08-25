'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildMonthGrid, isValidCalendarDate, isValidYearMonth } from '@/domain/calendarMonth.ts';
import { LoadingIndicator } from './LoadingIndicator';
import styles from './CalendarSkeleton.module.css';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year ?? yearMonth}年${String(Number(month ?? '1'))}月`;
}

export interface CalendarSkeletonProps {
  /** Japanese-language noun identifying what's loading (e.g.
   * "イベントカレンダー" / "My Calendar"), composed into this skeleton's
   * own accessible name the same way MonthCalendar.tsx / MyMonthCalendar.tsx
   * compose their section aria-label. */
  sectionLabel: string;
  /** Shown instead of the skeleton grid when the destination month can't be
   * determined from the URL (e.g. a hard/first load with no `month` query
   * param yet) - the same plain LoadingIndicator this route's loading.tsx
   * rendered before Issue #103, so that case is unchanged. */
  fallbackLabel: string;
}

/**
 * Mirrors resolveCatalogParams's / resolveMyCalendarParams's own
 * `date`-wins-over-`month` precedence (catalogNavigation.ts /
 * myCalendarNavigation.ts) - catalogDayHref/myCalendarDayHref carry the
 * *currently displayed* month in `month` even for an adjacent-month
 * lead/trail cell's `date` (e.g. viewing August, tapping a trailing
 * September 1st cell yields `?month=2026-08&date=2026-09-01`). Without
 * this precedence the skeleton would announce/render August, then flip to
 * September once the real page resolves - the exact "wrong month first"
 * regression P2 exists to avoid.
 */
function resolveSkeletonMonth(searchParams: URLSearchParams): string | null {
  const rawDate = searchParams.get('date');
  if (rawDate !== null && isValidCalendarDate(rawDate)) {
    return rawDate.slice(0, 7);
  }
  const rawMonth = searchParams.get('month');
  if (rawMonth !== null && isValidYearMonth(rawMonth)) {
    return rawMonth;
  }
  return null;
}

function CalendarSkeletonContent({ sectionLabel, fallbackLabel }: CalendarSkeletonProps) {
  const searchParams = useSearchParams();
  const month = resolveSkeletonMonth(searchParams);

  if (month === null) {
    return <LoadingIndicator label={fallbackLabel} />;
  }

  const grid = buildMonthGrid(month);
  const label = `${monthLabel(month)}の${sectionLabel}を読み込み中`;

  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {/* min-height matches the real header's own height (MonthCalendar
          .module.css / MyMonthCalendar.module.css .header), which comes
          from its two 40px-tall icon-variant LinkButtons, not the plain
          text line the label alone would be - without this the skeleton
          card is ~16px shorter than the real one, and the whole card
          visibly grows once the real header mounts. */}
      <div className={styles.header} aria-hidden="true">
        <p className={styles.monthLabel}>{monthLabel(month)}</p>
      </div>

      <div className={styles.weekdayRow} aria-hidden="true">
        {WEEKDAY_LABELS.map((weekdayLabel) => (
          <span key={weekdayLabel} className={styles.weekday}>
            {weekdayLabel}
          </span>
        ))}
      </div>

      <div aria-hidden="true">
        {grid.weeks.map((week, weekIndex) => (
          // Weeks are a stable, never-reordered sequence within one render
          // (same convention as MonthCalendar.tsx / MyMonthCalendar.tsx).
          <div key={weekIndex} className={styles.week}>
            {week.map((date) => (
              <span key={date} className={styles.day} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Segment-level loading.tsx fallback for the catalog/calendar month routes
 * (Issue #103, P2 - implemented because a dev-environment measurement
 * showed the loading.tsx boundary does fire on `?month=` navigation,
 * replacing the whole page with a single generic spinner). `?month=`
 * navigation updates the browser's URL before the destination page's data
 * resolves, so useSearchParams here already reads the destination month
 * while this fallback is showing - confirmed by the same measurement.
 * Reused to preserve the grid's exact week count/shape via buildMonthGrid,
 * the same pure function catalog/calendar page.tsx itself calls, and to
 * show the destination month label immediately instead of the previous
 * "everything disappears behind one generic spinner" state.
 *
 * The inner Suspense boundary is required by Next's own build-time rule
 * for useSearchParams (any component that reads it needs a Suspense
 * ancestor - see the "missing-suspense-with-csr-bailout" build error),
 * not a hand-rolled loading state of its own - this is the exact same
 * fallback content (LoadingIndicator) the isValidYearMonth-false branch
 * above already renders for "no destination month known yet", and in
 * practice resolves within the same client render pass since
 * useSearchParams has no actual async work to wait on.
 */
export function CalendarSkeleton(props: CalendarSkeletonProps) {
  return (
    <Suspense fallback={<LoadingIndicator label={props.fallbackLabel} />}>
      <CalendarSkeletonContent {...props} />
    </Suspense>
  );
}
