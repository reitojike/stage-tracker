import { BackLink } from '@/ui/BackLink';
import { LoadingIndicator } from '@/ui/LoadingIndicator';
import { PageHeading } from '@/ui/PageHeading';
import { catalogMonthHref } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../_lib/today.ts';

/**
 * Restates page.tsx's own unconditional BackLink, plus the "招待一覧"
 * heading page.tsx/InvitationList always show regardless of read outcome
 * (Issue #355). This corrects Issue #355's own starting allowlist, which
 * omitted BackLink for this route before fresh verification against
 * current page.tsx control flow - BackLink there sits ahead of every
 * conditional branch, exactly like the other routes already listed with
 * it.
 *
 * The real heading's "未回答 {n}件" count is client-local state
 * (InvitationList) this fallback cannot see, so only the count-free
 * heading is restated here - the same bound Issue #355 draws.
 */
export default function InvitationsLoading() {
  return (
    <>
      <BackLink href={catalogMonthHref(currentTokyoDate().slice(0, 7))}>カレンダーに戻る</BackLink>
      <PageHeading>招待一覧</PageHeading>
      <LoadingIndicator label="招待一覧を読み込み中" />
    </>
  );
}
