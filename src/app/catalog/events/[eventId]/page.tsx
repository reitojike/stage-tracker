import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { getEventWithOccurrences } from '@/infrastructure/supabase/eventCatalogRead';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import { canUpdateEvent } from '@/domain/eventPermissions';
import {
  catalogDayHref,
  catalogEditEventHref,
  catalogMonthHref,
  resolveCatalogParams,
} from '@/domain/catalogNavigation';
import type { EventWithOccurrences } from '@/domain/eventCatalog';
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
  const result = await getEventWithOccurrences(client, eventId);
  const state = resolveCatalogReadState(result, isMissingEvent);

  const backHref =
    context.selectedDate !== null
      ? catalogDayHref(context.yearMonth, context.selectedDate)
      : catalogMonthHref(context.yearMonth);

  // Owner-only edit affordance (Issue #29). Everyone authenticated still
  // reads the same event; only the link differs. nextOwnerId is the
  // current owner because this link never offers an ownership change.
  const user = await getAuthenticatedUser();
  const event = result.ok ? result.data : null;
  const editHref =
    event !== null &&
    canUpdateEvent(user?.id ?? null, { ownerId: event.event.ownerId }, event.event.ownerId)
      ? catalogEditEventHref(eventId, context)
      : null;

  return (
    <main>
      <Link href={backHref}>← カレンダーに戻る</Link>

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
      {event !== null ? <EventDetail data={event} editHref={editHref} /> : null}
    </main>
  );
}
