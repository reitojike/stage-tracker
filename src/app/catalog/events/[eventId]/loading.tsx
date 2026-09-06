import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { catalogMonthHref } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../../_lib/today.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present
 * regardless of the read outcome, unlike this route's content.
 *
 * The month/day query-string context page.tsx's own BackLink carries is
 * not reproduced: loading.tsx receives no params/searchParams from
 * Next.js, so this falls back to the current month - the same default
 * page.tsx's own resolveCatalogParams uses when no context is present.
 */
export default function EventDetailLoading() {
  return (
    <>
      <BackLink href={catalogMonthHref(currentTokyoDate().slice(0, 7))}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="公演情報を読み込み中" />
    </>
  );
}
