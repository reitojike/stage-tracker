import { ActionRow } from '@/ui/ActionRow';
import { CalendarSkeleton } from '@/ui/CalendarSkeleton';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';

/**
 * Restates page.tsx's own PageHeading/ActionRow (Issue #103, P2) - both are
 * unconditional there, so this fallback can show them exactly as-is rather
 * than approximating. Without this, a `?month=` navigation would drop the
 * page title and primary action out of the layout while pending, only to
 * have them reflow back in - shifting the calendar down - once the real
 * page commits.
 */
export default function MyCalendarLoading() {
  return (
    <>
      <PageHeading>マイカレンダー</PageHeading>
      <ActionRow>
        <LinkButton href="/schedule" variant="secondary">
          個人予定を管理
        </LinkButton>
      </ActionRow>
      <CalendarSkeleton sectionLabel="マイカレンダー" fallbackLabel="マイカレンダーを読み込み中" />
    </>
  );
}
