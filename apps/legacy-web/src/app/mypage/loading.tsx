import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { PageHeading } from '@/ui/PageHeading';

/**
 * Restates page.tsx's own unconditional PageHeading (mirrors
 * src/app/calendar/loading.tsx's own reasoning) so a pending navigation
 * doesn't drop the page title, only to have it reflow back in once the
 * real page commits.
 */
export default function MyPageLoading() {
  return (
    <>
      <PageHeading>マイページ</PageHeading>
      <LoadingIndicator label="マイページを読み込み中" />
    </>
  );
}
