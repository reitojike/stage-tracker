'use client';

import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import {
  catalogDayHref,
  catalogMonthHref,
  resolveCatalogParams,
  searchParamsToRecord,
} from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../../_lib/today.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present
 * regardless of the read outcome, unlike this route's content.
 *
 * A Client Component so it can read the same month/day query-string
 * context page.tsx's own BackLink carries via `useSearchParams()` (see
 * src/app/catalog/events/new/loading.tsx's own comment for why this
 * reproduces the exact destination rather than an approximation).
 */
export default function EventDetailLoading() {
  const searchParams = useSearchParams();
  const context = resolveCatalogParams(searchParamsToRecord(searchParams), currentTokyoDate());
  const backHref =
    context.selectedDate !== null
      ? catalogDayHref(context.yearMonth, context.selectedDate)
      : catalogMonthHref(context.yearMonth);

  return (
    <>
      <BackLink href={backHref}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="公演情報を読み込み中" />
    </>
  );
}
