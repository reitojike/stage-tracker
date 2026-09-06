import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { catalogMonthHref } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../../_lib/today.ts';

/**
 * Restates page.tsx's own unconditional BackLink (Issue #355) - present in
 * every branch, including the auth-failure and permission-denied ones.
 * `PageHeading` is deliberately not restated here: it only renders after
 * the auth + designated-creator check both pass, so this fallback would be
 * fabricating a data/permission-dependent heading rather than a stable one
 * (see docs/ux-ui.md's loading rule). This corrects Issue #355's own
 * starting allowlist, which listed this route as `PageHeading` before
 * fresh verification against current page.tsx control flow.
 *
 * The month/day query-string context page.tsx's own BackLink carries is
 * not reproduced: loading.tsx receives no params/searchParams from
 * Next.js, so this falls back to the current month - the same default
 * page.tsx's own resolveCatalogParams uses when no context is present.
 */
export default function NewEventLoading() {
  return (
    <>
      <BackLink href={catalogMonthHref(currentTokyoDate().slice(0, 7))}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="登録フォームを準備中" />
    </>
  );
}
