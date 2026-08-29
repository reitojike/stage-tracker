import { CalendarSkeleton } from '@/ui/CalendarSkeleton';
import { PageHeading } from '@/ui/PageHeading';

/**
 * Restates page.tsx's own PageHeading (Issue #103, P2) so a `?month=`
 * navigation doesn't drop the page title out of the layout while pending,
 * only to have it reflow back in - and shift the calendar down - once the
 * real page commits. Issue #195 removed page.tsx's own ActionRow ("+ 追加" /
 * "招待一覧" - both are reachable through My Page's own "予定とイベント"
 * section now), so this fallback no longer restates one either.
 */
export default function CatalogLoading() {
  return (
    <>
      <PageHeading>イベント</PageHeading>
      <CalendarSkeleton sectionLabel="イベントカレンダー" fallbackLabel="カレンダーを読み込み中" />
    </>
  );
}
