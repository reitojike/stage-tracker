import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleEntryBackHref } from '@/domain/myCalendarNavigation.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present
 * regardless of the read outcome.
 *
 * The `month` query-string context page.tsx's own BackLink carries is not
 * reproduced: loading.tsx receives no searchParams from Next.js, so this
 * calls scheduleEntryBackHref with no month - the same fallback
 * ('/calendar') the real function already returns for a missing/invalid
 * month param.
 */
export default function ScheduleEntryLoading() {
  return (
    <>
      <BackLink href={scheduleEntryBackHref(undefined)}>マイカレンダーに戻る</BackLink>
      <LoadingIndicator label="予定を読み込み中" />
    </>
  );
}
