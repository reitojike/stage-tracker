import { BackLink } from '@/ui/BackLink';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { listMyReceivedInvitations } from '@/infrastructure/supabase/invitation';
import { getEventsByIds, getOccurrencesByIds } from '@/infrastructure/supabase/eventCatalogRead';
import { resolvePlanningReadState } from '@/domain/planningError';
import { isEffectivelyCanceled } from '@/domain/eventCancellation';
import type { Invitation } from '@/domain/invitation';
import { catalogMonthHref } from '@/domain/catalogNavigation';
import { currentTokyoDate } from '../_lib/today.ts';
import { InvitationCard } from '../_components/InvitationCard.tsx';

const isEmptyInvitations = (data: Invitation[]) => data.length === 0;

/**
 * The viewer's own received invitations, across every occurrence (Issue
 * #36). product-rules.md restricts SELECT on occurrence_invitations to the
 * invitee, so listMyReceivedInvitations can never surface one the viewer
 * sent - there is deliberately no "invitations I sent" view here (see that
 * function's header in src/infrastructure/supabase/invitation.ts).
 *
 * An invitation only carries an occurrence id, so event/occurrence context
 * is resolved in two further reads (getOccurrencesByIds, getEventsByIds)
 * rather than being embedded in the invitation itself - those tables are
 * part of the shared catalog, openly readable by every authenticated user,
 * so this adds no new access surface.
 */
export default async function InvitationsPage() {
  const client = await createSupabaseServerClient();
  const invitationsResult = await listMyReceivedInvitations(client);
  const state = resolvePlanningReadState(invitationsResult, isEmptyInvitations);

  const invitations = invitationsResult.ok ? invitationsResult.data : [];
  const occurrenceIds = [...new Set(invitations.map((invitation) => invitation.occurrenceId))];

  let contextReadFailed = false;
  const occurrenceById = new Map<string, { startsAt: string; endsAt: string | null }>();
  const eventTitleByOccurrenceId = new Map<string, string>();
  const isCanceledByOccurrenceId = new Map<string, boolean>();

  if (occurrenceIds.length > 0) {
    const occurrencesResult = await getOccurrencesByIds(client, occurrenceIds);
    if (!occurrencesResult.ok) {
      contextReadFailed = true;
    } else {
      for (const occurrence of occurrencesResult.data) {
        occurrenceById.set(occurrence.id, {
          startsAt: occurrence.startsAt,
          endsAt: occurrence.endsAt,
        });
      }

      const eventIds = [...new Set(occurrencesResult.data.map((occurrence) => occurrence.eventId))];
      const eventsResult = await getEventsByIds(client, eventIds);
      if (!eventsResult.ok) {
        contextReadFailed = true;
      } else {
        const eventById = new Map(eventsResult.data.map((event) => [event.id, event]));
        for (const occurrence of occurrencesResult.data) {
          const event = eventById.get(occurrence.eventId);
          if (event !== undefined) {
            eventTitleByOccurrenceId.set(occurrence.id, event.title);
            isCanceledByOccurrenceId.set(occurrence.id, isEffectivelyCanceled(event, occurrence));
          }
        }
      }
    }
  }

  return (
    <>
      <BackLink href={catalogMonthHref(currentTokyoDate().slice(0, 7))}>カレンダーに戻る</BackLink>
      <PageHeading>招待一覧</PageHeading>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="招待を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}
      {contextReadFailed ? (
        <StatePanel
          variant="error"
          title="招待の詳細を読み込めませんでした"
          description="通信状況を確認し、ページを再読み込みしてください。"
        />
      ) : null}
      {state === 'empty' ? <StatePanel variant="empty" title="招待はありません" /> : null}

      {state === 'populated' ? (
        <ul>
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <InvitationCard
                invitation={invitation}
                occurrence={occurrenceById.get(invitation.occurrenceId) ?? null}
                eventTitle={eventTitleByOccurrenceId.get(invitation.occurrenceId) ?? null}
                isEffectivelyCanceled={
                  isCanceledByOccurrenceId.get(invitation.occurrenceId) ?? false
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
