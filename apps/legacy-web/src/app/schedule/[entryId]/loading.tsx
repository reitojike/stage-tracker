'use client';

import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleEntryBackHref } from '@/domain/myCalendarNavigation.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present
 * regardless of the read outcome.
 *
 * A Client Component so it can read the same `month` query-string context
 * page.tsx's own BackLink carries via `useSearchParams()`, reproducing its
 * exact destination rather than an approximation (see
 * src/app/catalog/events/new/loading.tsx's own comment for why this
 * resolves correctly even during the initial server-rendered pass).
 */
export default function ScheduleEntryLoading() {
  const searchParams = useSearchParams();

  return (
    <>
      <BackLink href={scheduleEntryBackHref(searchParams.get('month') ?? undefined)}>
        マイカレンダーに戻る
      </BackLink>
      <LoadingIndicator label="予定を読み込み中" />
    </>
  );
}
