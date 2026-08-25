import { ActionRow } from '@/ui/ActionRow';
import { CalendarSkeleton } from '@/ui/CalendarSkeleton';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { catalogInvitationsHref } from '@/domain/catalogNavigation.ts';

/**
 * Restates page.tsx's own PageHeading/ActionRow (Issue #103, P2) so a
 * `?month=` navigation doesn't drop the page title and primary action out
 * of the layout while pending, only to have them reflow back in - and
 * shift the calendar down - once the real page commits. The
 * designated-catalog-creator-only "+ イベントを登録" button is
 * intentionally omitted: unlike 招待一覧を見る (always shown), it depends
 * on an async membership check page.tsx itself awaits, which this static
 * fallback has no way to know before that check resolves.
 */
export default function CatalogLoading() {
  return (
    <>
      <PageHeading>イベント</PageHeading>
      <ActionRow>
        <LinkButton href={catalogInvitationsHref()} variant="secondary">
          招待一覧
        </LinkButton>
      </ActionRow>
      <CalendarSkeleton sectionLabel="イベントカレンダー" fallbackLabel="カレンダーを読み込み中" />
    </>
  );
}
