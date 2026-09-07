import { PageHeading } from '@/ui/PageHeading';
import { LoadingIndicator } from '@/ui/LoadingIndicator';

/**
 * Restates page.tsx's own unconditional PageHeading (mirrors
 * src/app/calendar/loading.tsx's own reasoning) so a pending navigation
 * doesn't drop the page title, only to have it reflow back in once the real
 * page commits.
 */
export default function TicketsLoading() {
  return (
    <>
      <PageHeading>チケット</PageHeading>
      <LoadingIndicator label="チケットスケジュールを読み込み中" />
    </>
  );
}
