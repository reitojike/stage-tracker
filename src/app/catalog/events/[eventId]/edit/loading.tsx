'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import {
  catalogEventHref,
  catalogEventHrefWithoutContext,
  explicitCatalogParams,
  searchParamsToRecord,
} from '@/domain/catalogNavigation';

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
 * A Client Component so it can read `eventId` (via `useParams()`) and the
 * month/day query-string context (via `useSearchParams()`) page.tsx's own
 * BackLink carries, reproducing its exact "公演情報に戻る" destination
 * rather than falling back to a different one - loading.tsx receives no
 * `params`/`searchParams` props from Next.js, but these hooks resolve
 * correctly even during the initial server-rendered pass (see
 * src/app/catalog/events/new/loading.tsx's own comment). A destination
 * that differs from page.tsx's own is a navigation-semantics change, not
 * just a layout-stability one (PR #363 review) - eventId is a path segment
 * of the current URL, not fetched data, so it is always available here.
 *
 * When no explicit month/day is in the URL, this links to the event's
 * detail page with no query string at all (`catalogEventHrefWithoutContext`)
 * rather than computing "today" itself: a Client Component's `new Date()`
 * reads the browser's clock, not the server's, and could disagree with
 * what page.tsx (always server-rendered) resolves once it actually loads
 * (PR #363 review, round 2: codex). The detail page resolves its own
 * default month server-side once it actually loads.
 */
export default function EditEventLoading() {
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const context = explicitCatalogParams(searchParamsToRecord(searchParams));
  const backHref =
    context === null ? catalogEventHrefWithoutContext(eventId) : catalogEventHref(eventId, context);

  return (
    <>
      <BackLink href={backHref}>公演情報に戻る</BackLink>
      <LoadingIndicator label="編集フォームを読み込み中" />
    </>
  );
}
