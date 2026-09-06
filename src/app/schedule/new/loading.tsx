import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { scheduleNewBackHref } from '@/domain/myCalendarNavigation.ts';
import { SchedulePageHeading } from '../_components/SchedulePageHeading.tsx';

/**
 * Restates page.tsx's own unconditional BackLink and SchedulePageHeading
 * (Issue #355) - this route has no branches at all, so both are always
 * present.
 *
 * The `date` query-string context page.tsx's own BackLink carries is not
 * reproduced: loading.tsx receives no searchParams from Next.js, so this
 * calls scheduleNewBackHref with no date - the same fallback ('/calendar')
 * the real function already returns for a missing/invalid date param.
 */
export default function NewScheduleLoading() {
  return (
    <>
      <BackLink href={scheduleNewBackHref(undefined)}>マイカレンダーに戻る</BackLink>
      <SchedulePageHeading>予定を追加</SchedulePageHeading>
      <LoadingIndicator label="読み込み中" />
    </>
  );
}
