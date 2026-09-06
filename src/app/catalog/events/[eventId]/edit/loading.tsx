import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { catalogMonthHref } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../../../_lib/today.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present in
 * every branch, including the load-failure/not-found/permission-denied
 * ones. `PageHeading` is deliberately not restated here: it only renders
 * after the event loads and canEdit passes, so this fallback would be
 * fabricating a data/permission-dependent heading rather than a stable one
 * (see docs/ux-ui.md's loading rule). This corrects Issue #355's own
 * starting allowlist, which listed this route as `PageHeading` before
 * fresh verification against current page.tsx control flow.
 *
 * page.tsx's own BackLink points at this specific event's detail page
 * ("公演情報に戻る", via catalogEventHref(eventId, context)) - unreachable
 * here since loading.tsx receives no params/searchParams from Next.js, so
 * eventId itself is unavailable. This falls back to the calendar-root
 * label+destination pair the sibling create screen's own BackLink uses
 * (src/app/catalog/events/new/loading.tsx) instead of a label that
 * promises a destination this fallback cannot deliver.
 */
export default function EditEventLoading() {
  return (
    <>
      <BackLink href={catalogMonthHref(currentTokyoDate().slice(0, 7))}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="編集フォームを読み込み中" />
    </>
  );
}
