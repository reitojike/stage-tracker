import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleEntryBackHref } from '@/domain/myCalendarNavigation.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present in
 * every branch, including the load-failure/not-found/permission-denied
 * ones. `SchedulePageHeading` is deliberately not restated here: it only
 * renders after the entry loads and canEdit passes, so this fallback would
 * be fabricating a data/permission-dependent heading rather than a stable
 * one (see docs/ux-ui.md's loading rule).
 *
 * page.tsx's own BackLink points at this specific entry's detail page
 * ("予定に戻る", via scheduleEntryDetailHref(entryId, month)) -
 * unreachable here since loading.tsx receives no params/searchParams from
 * Next.js, so entryId itself is unavailable. This falls back to the same
 * calendar-root label+destination pair the sibling detail screen's own
 * BackLink uses (../loading.tsx) instead of a label that promises a
 * destination this fallback cannot deliver.
 */
export default function EditScheduleEntryLoading() {
  return (
    <>
      <BackLink href={scheduleEntryBackHref(undefined)}>マイカレンダーに戻る</BackLink>
      <LoadingIndicator label="読み込み中" />
    </>
  );
}
