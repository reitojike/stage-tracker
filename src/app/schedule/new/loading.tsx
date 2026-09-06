'use client';

import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleNewBackHref } from '@/domain/myCalendarNavigation.ts';
import { SchedulePageHeading } from '../_components/SchedulePageHeading.tsx';

/**
 * Restates page.tsx's own unconditional BackLink and SchedulePageHeading
 * (Issue #355) - this route has no branches at all, so both are always
 * present.
 *
 * A Client Component so it can read the same `date` query-string context
 * page.tsx's own BackLink carries via `useSearchParams()`, reproducing its
 * exact destination rather than an approximation (see
 * src/app/catalog/events/new/loading.tsx's own comment for why this
 * resolves correctly even during the initial server-rendered pass).
 */
export default function NewScheduleLoading() {
  const searchParams = useSearchParams();

  return (
    <>
      <BackLink href={scheduleNewBackHref(searchParams.get('date') ?? undefined)}>
        マイカレンダーに戻る
      </BackLink>
      <SchedulePageHeading>予定を追加</SchedulePageHeading>
      <LoadingIndicator label="読み込み中" />
    </>
  );
}
