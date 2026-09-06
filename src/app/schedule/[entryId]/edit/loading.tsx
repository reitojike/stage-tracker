'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleEntryDetailHref } from '@/domain/myCalendarNavigation.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present in
 * every branch, including the load-failure/not-found/permission-denied
 * ones. `SchedulePageHeading` is deliberately not restated here: it only
 * renders after the entry loads and canEdit passes, so this fallback would
 * be fabricating a data/permission-dependent heading rather than a stable
 * one (see docs/ux-ui.md's loading rule).
 *
 * A Client Component so it can read `entryId` (via `useParams()`) and the
 * `month` query-string context (via `useSearchParams()`) page.tsx's own
 * BackLink carries, reproducing its exact "予定に戻る" destination rather
 * than falling back to a different one - loading.tsx receives no
 * `params`/`searchParams` props from Next.js, but these hooks resolve
 * correctly even during the initial server-rendered pass (see
 * src/app/catalog/events/new/loading.tsx's own comment). A destination
 * that differs from page.tsx's own is a navigation-semantics change, not
 * just a layout-stability one (PR #363 review) - entryId is a path segment
 * of the current URL, not fetched data, so it is always available here.
 */
export default function EditScheduleEntryLoading() {
  const { entryId } = useParams<{ entryId: string }>();
  const searchParams = useSearchParams();

  return (
    <>
      <BackLink href={scheduleEntryDetailHref(entryId, searchParams.get('month') ?? undefined)}>
        予定に戻る
      </BackLink>
      <LoadingIndicator label="読み込み中" />
    </>
  );
}
