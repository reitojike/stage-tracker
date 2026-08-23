import { BackLink } from '@/ui/BackLink';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { getEventWithOccurrences } from '@/infrastructure/supabase/eventCatalogRead';
import { getMyParticipationsForOccurrences } from '@/infrastructure/supabase/participation';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import { canUpdateEvent } from '@/domain/eventPermissions';
import {
  catalogDayHref,
  catalogEditEventHref,
  catalogMonthHref,
  resolveCatalogParams,
} from '@/domain/catalogNavigation';
import type { EventWithOccurrences } from '@/domain/eventCatalog';
import type { Participation } from '@/domain/participation';
import { currentTokyoDate } from '../../_lib/today.ts';
import { EventDetail } from '../../_components/EventDetail.tsx';

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isMissingEvent = (data: EventWithOccurrences | null) => data === null;

/**
 * Read-only single-event inspect surface (Issue #20). Data comes entirely
 * through #12's getEventWithOccurrences over a #11 server Supabase client;
 * a non-existent id is a distinct "empty" result (not an error), and an
 * RLS/network failure is a distinct "error" (never presented as empty) -
 * see resolveCatalogReadState.
 */
export default async function EventDetailPage({ params, searchParams }: EventDetailPageProps) {
  const { eventId } = await params;
  const rawParams = await searchParams;
  const context = resolveCatalogParams(rawParams, currentTokyoDate());

  const client = await createSupabaseServerClient();
  // Independent reads (event data, current user) run concurrently rather
  // than sequentially - neither depends on the other's result.
  const [result, user] = await Promise.all([
    getEventWithOccurrences(client, eventId),
    getAuthenticatedUser(),
  ]);
  const state = resolveCatalogReadState(result, isMissingEvent);

  const backHref =
    context.selectedDate !== null
      ? catalogDayHref(context.yearMonth, context.selectedDate)
      : catalogMonthHref(context.yearMonth);

  // Owner-only edit affordance (Issue #29). Everyone authenticated still
  // reads the same event; only the link differs. nextOwnerId is the
  // current owner because this link never offers an ownership change.
  const event = result.ok ? result.data : null;
  const editHref =
    event !== null &&
    canUpdateEvent(user?.id ?? null, { ownerId: event.event.ownerId }, event.event.ownerId)
      ? catalogEditEventHref(eventId, context)
      : null;

  // The viewer's own participation for every occurrence (Issue #36), read
  // in one round trip for the whole event via getMyParticipationsForOccurrences
  // rather than one call per occurrence. A missing session (user === null)
  // simply shows no participation controls at all - this route is already
  // behind the app's default-deny auth gate, so that path is not expected
  // to be reachable in practice; it is not treated as a read failure. An
  // actual read failure while authenticated (participationReadFailed) is
  // reported as StatePanel `error`, never silently as "no participation" -
  // the absence of a map entry is what makes EventDetail skip rendering
  // ParticipationPanel for that occurrence instead of guessing at a
  // default (see EventDetail.tsx). Every occurrence gets an explicit entry
  // (null when the batched read found no row for it), preserving that
  // has()-based distinction even though the batched read itself only
  // returns entries for occurrences that do have a row.
  const participationsByOccurrenceId = new Map<string, Participation | null>();
  let participationReadFailed = false;
  if (event !== null && user !== null) {
    const occurrenceIds = event.occurrences.map((occurrence) => occurrence.id);
    const participationsResult = await getMyParticipationsForOccurrences(client, occurrenceIds);
    if (participationsResult.ok) {
      for (const occurrenceId of occurrenceIds) {
        participationsByOccurrenceId.set(
          occurrenceId,
          participationsResult.data.get(occurrenceId) ?? null,
        );
      }
    } else {
      participationReadFailed = true;
    }
  }

  return (
    <>
      <BackLink href={backHref}>カレンダーに戻る</BackLink>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="公演情報を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}
      {state === 'empty' ? (
        <StatePanel variant="empty" title="指定された公演が見つかりません" />
      ) : null}
      {participationReadFailed ? (
        <StatePanel
          variant="error"
          title="参加予定を読み込めませんでした"
          description="通信状況を確認し、ページを再読み込みしてください。"
        />
      ) : null}
      {event !== null ? (
        <EventDetail
          data={event}
          editHref={editHref}
          participationsByOccurrenceId={participationsByOccurrenceId}
        />
      ) : null}
    </>
  );
}
