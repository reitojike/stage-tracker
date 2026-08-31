import { BackLink } from '@/ui/BackLink';
import { Badge } from '@/ui/Badge';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { getEventWithOccurrences } from '@/infrastructure/supabase/eventCatalogRead';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
import { isEffectivelyCanceled } from '@/domain/eventCancellation';
import {
  canUpdateEvent,
  canDeleteEvent,
  canDeleteEventOccurrence,
  canCancelEvent,
  canCancelEventOccurrence,
} from '@/domain/eventPermissions';
import { resolveWriteFeedback } from '@/domain/eventWriteFeedback';
import {
  eventDetailsToFormValues,
  eventRangeToFormValues,
  occurrenceToFormValues,
} from '@/domain/eventCatalogWrite';
import {
  eventDateRangeLabel,
  occurrenceTimeRangeLabel,
  tokyoTimeLabel,
} from '@/domain/catalogFormatting';
import { tokyoLocalInstant } from '@/domain/eventCatalog';
import { catalogEventHref, resolveCatalogParams } from '@/domain/catalogNavigation';
import type { EventWithOccurrences } from '@/domain/eventCatalog';
import { currentTokyoDate } from '../../../_lib/today.ts';
import { DeleteEventForm } from '../../../_components/DeleteEventForm.tsx';
import { EventCancellationForm } from '../../../_components/EventCancellationForm.tsx';
import { EventDetailsEditForm } from '../../../_components/EventDetailsEditForm.tsx';
import { EventRangeEditForm } from '../../../_components/EventRangeEditForm.tsx';
import { EventWriteSection } from '../../../_components/EventWriteSection.tsx';
import { OccurrenceAddForm } from '../../../_components/OccurrenceAddForm.tsx';
import { OccurrenceUpdateForm } from '../../../_components/OccurrenceUpdateForm.tsx';
import styles from '../../../_components/EventWriteForm.module.css';

interface EditEventPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isMissingEvent = (data: EventWithOccurrences | null) => data === null;

const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];

function occurrenceRowLabel(startsAt: string, endsAt: string | null): string {
  const starts = tokyoLocalInstant(startsAt);
  const date = `${String(starts.getUTCMonth() + 1)}月${String(starts.getUTCDate())}日（${
    weekdayLabels[starts.getUTCDay()] ?? ''
  }）`;
  return `${date} ${occurrenceTimeRangeLabel(startsAt, endsAt)}`;
}

function occurrenceRowDetail(doorsAt: string | null, endsAt: string | null): string {
  if (doorsAt !== null) {
    return `開場 ${tokyoTimeLabel(doorsAt)}`;
  }
  return endsAt === null ? '終演 未定' : '開場 未公表';
}

/** Owner-only Event write screen. Presentation is local to this route; all
 * existing server actions and RLS-backed authorization remain unchanged. */
export default async function EditEventPage({ params, searchParams }: EditEventPageProps) {
  const { eventId } = await params;
  const rawParams = await searchParams;
  const context = resolveCatalogParams(rawParams, currentTokyoDate());
  const detailHref = catalogEventHref(eventId, context);

  const user = await getAuthenticatedUser();
  const client = await createSupabaseServerClient();
  const result = await getEventWithOccurrences(client, eventId);
  const state = resolveCatalogReadState(result, isMissingEvent);

  if (state === 'error') {
    return (
      <>
        <BackLink href={detailHref}>公演情報に戻る</BackLink>
        <StatePanel
          variant="error"
          title="公演情報を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </>
    );
  }

  if (state === 'empty' || !result.ok || result.data === null) {
    return (
      <>
        <BackLink href={detailHref}>公演情報に戻る</BackLink>
        <StatePanel variant="empty" title="指定された公演が見つかりません" />
      </>
    );
  }

  const { event, occurrences } = result.data;
  const canEdit = canUpdateEvent(user?.id ?? null, { ownerId: event.ownerId }, event.ownerId);

  if (!canEdit) {
    const denial = resolveWriteFeedback('update-event', 'permission-denied');
    return (
      <>
        <BackLink href={detailHref}>公演情報に戻る</BackLink>
        <StatePanel
          variant={denial.variant}
          title={denial.title}
          description={denial.description}
        />
      </>
    );
  }

  const canDeleteOccurrence = canDeleteEventOccurrence(user?.id ?? null, {
    ownerId: event.ownerId,
  });
  const canCancelOccurrence = canCancelEventOccurrence(user?.id ?? null, {
    ownerId: event.ownerId,
  });

  return (
    <>
      <BackLink href={detailHref}>公演情報に戻る</BackLink>
      <PageHeading>{event.title} を編集</PageHeading>

      <EventWriteSection heading="イベント情報">
        <EventDetailsEditForm eventId={event.id} initialValues={eventDetailsToFormValues(event)} />
      </EventWriteSection>

      <EventWriteSection
        heading="開催期間"
        action={
          <EventRangeEditForm eventId={event.id} initialValues={eventRangeToFormValues(event)} />
        }
      >
        <p className={styles.rangeSummary}>{eventDateRangeLabel(event.startsOn, event.endsOn)}</p>
      </EventWriteSection>

      <EventWriteSection heading="公演回" action={<OccurrenceAddForm eventId={event.id} />}>
        <div className={styles.occurrenceList}>
          {occurrences.map((occurrence) => {
            const label = occurrenceRowLabel(occurrence.startsAt, occurrence.endsAt);
            const detail = occurrenceRowDetail(occurrence.doorsAt, occurrence.endsAt);
            const effectivelyCanceled = isEffectivelyCanceled(event, occurrence);
            return (
              <div key={occurrence.id} className={styles.occurrenceRow}>
                <div className={styles.occurrenceSummary}>
                  <div className={styles.occurrenceDateTimeRow}>
                    {effectivelyCanceled ? (
                      <Badge variant="terminal" className={styles.occurrenceCanceledBadge}>
                        中止
                      </Badge>
                    ) : null}
                    <span
                      className={[
                        styles.occurrenceDateTime,
                        effectivelyCanceled ? styles.occurrenceCanceled : undefined,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {label}
                    </span>
                  </div>
                  <span className={styles.occurrenceDetail}>{detail}</span>
                </div>
                <OccurrenceUpdateForm
                  eventId={event.id}
                  occurrenceId={occurrence.id}
                  label={label}
                  initialValues={occurrenceToFormValues({
                    doorsAtUtc: occurrence.doorsAt,
                    startsAtUtc: occurrence.startsAt,
                    endsAtUtc: occurrence.endsAt,
                  })}
                  canCancel={canCancelOccurrence}
                  canDelete={canDeleteOccurrence}
                  isCanceled={occurrence.canceledAt !== null}
                />
              </div>
            );
          })}
        </div>
      </EventWriteSection>

      <EventWriteSection heading="中止と削除" danger>
        <div className={styles.dangerActions}>
          {canCancelEvent(user?.id ?? null, { ownerId: event.ownerId }) && (
            <EventCancellationForm eventId={event.id} isCanceled={event.canceledAt !== null} />
          )}
          {canDeleteEvent(user?.id ?? null, { ownerId: event.ownerId }) && (
            <DeleteEventForm eventId={event.id} />
          )}
        </div>
      </EventWriteSection>
    </>
  );
}
