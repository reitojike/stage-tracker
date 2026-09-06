'use client';

import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import {
  catalogDayHref,
  catalogMonthHref,
  explicitCatalogParams,
  searchParamsToRecord,
} from '@/domain/catalogNavigation';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present
 * regardless of the read outcome, unlike this route's content.
 *
 * A Client Component so it can read the same month/day query-string
 * context page.tsx's own BackLink carries via `useSearchParams()` (see
 * src/app/catalog/events/new/loading.tsx's own comment for why this
 * resolves correctly even during the initial server-rendered pass, and
 * why the no-context case links to bare `/catalog` rather than computing
 * "today" itself from the browser's clock).
 */
export default function EventDetailLoading() {
  const searchParams = useSearchParams();
  const context = explicitCatalogParams(searchParamsToRecord(searchParams));
  const backHref =
    context === null
      ? '/catalog'
      : context.selectedDate !== null
        ? catalogDayHref(context.yearMonth, context.selectedDate)
        : catalogMonthHref(context.yearMonth);

  return (
    <>
      <BackLink href={backHref}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="公演情報を読み込み中" />
    </>
  );
}
