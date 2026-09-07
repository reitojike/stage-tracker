'use client';

import { useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import {
  catalogMonthHref,
  explicitCatalogParams,
  searchParamsToRecord,
} from '@/domain/catalogNavigation';

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
 * A Client Component so it can read the same month/day query-string
 * context page.tsx's own BackLink carries via `useSearchParams()` -
 * loading.tsx receives no `params`/`searchParams` props from Next.js, but
 * `useSearchParams()`/`useParams()` resolve correctly even during the
 * initial server-rendered pass (Next's App Router provides their context
 * server-side, not only after client hydration), so this reproduces
 * page.tsx's exact destination rather than an approximation (PR #363
 * review: a fallback destination/label that differs from the real page's
 * own is a navigation-semantics change, not just a layout-stability one).
 *
 * When no explicit month/day is in the URL, this links to bare `/catalog`
 * rather than computing "today" itself: a Client Component's `new Date()`
 * reads the browser's clock, not the server's, and could disagree with
 * what page.tsx (always server-rendered) resolves once it actually loads
 * (PR #363 review, round 2: codex). `/catalog` lets the destination decide
 * its own default month server-side, the same as page.tsx's BackLink would
 * if it too had no context to carry.
 */
export default function NewEventLoading() {
  const searchParams = useSearchParams();
  const context = explicitCatalogParams(searchParamsToRecord(searchParams));
  const backHref = context === null ? '/catalog' : catalogMonthHref(context.yearMonth);

  return (
    <>
      <BackLink href={backHref}>カレンダーに戻る</BackLink>
      <LoadingIndicator label="登録フォームを準備中" />
    </>
  );
}
