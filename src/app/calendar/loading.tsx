import { CalendarSkeleton } from '@/ui/CalendarSkeleton';
import { PageHeading } from '@/ui/PageHeading';

/**
 * Restates page.tsx's own unconditional PageHeading (Issue #103, P2), so
 * this fallback can show it exactly as-is rather than approximating.
 * Without this, a `?month=` navigation would drop the page title out of
 * the layout while pending, only to have it reflow back in - shifting the
 * calendar down - once the real page commits.
 *
 * Issue #196: page.tsx no longer renders an ActionRow here (the "個人予定を
 * 管理" action moved to My Page - #193), so this skeleton no longer
 * restates one either - keeping it would show a control that vanishes the
 * moment the real page commits, the same layout-shift this file exists to
 * avoid.
 */
export default function MyCalendarLoading() {
  return (
    <>
      <PageHeading>カレンダー</PageHeading>
      <CalendarSkeleton sectionLabel="カレンダー" fallbackLabel="カレンダーを読み込み中" />
    </>
  );
}
