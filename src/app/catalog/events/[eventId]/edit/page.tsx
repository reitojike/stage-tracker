import { BackLink } from '@/ui/BackLink';
import { FormSection } from '@/ui/FormSection';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session';
import { getEventWithOccurrences } from '@/infrastructure/supabase/eventCatalogRead';
import { resolveCatalogReadState } from '@/domain/catalogReadState';
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
import { occurrenceTimeRangeLabel, tokyoDateLabel } from '@/domain/catalogFormatting';
import { catalogEventHref, resolveCatalogParams } from '@/domain/catalogNavigation';
import type { EventWithOccurrences } from '@/domain/eventCatalog';
import { currentTokyoDate } from '../../../_lib/today.ts';
import { EventDetailsEditForm } from '../../../_components/EventDetailsEditForm.tsx';
import { EventRangeEditForm } from '../../../_components/EventRangeEditForm.tsx';
import { OccurrenceAddForm } from '../../../_components/OccurrenceAddForm.tsx';
import { OccurrenceUpdateForm } from '../../../_components/OccurrenceUpdateForm.tsx';
import { DeleteOccurrenceForm } from '../../../_components/DeleteOccurrenceForm.tsx';
import { DeleteEventForm } from '../../../_components/DeleteEventForm.tsx';
import { OccurrenceCancellationForm } from '../../../_components/OccurrenceCancellationForm.tsx';
import { EventCancellationForm } from '../../../_components/EventCancellationForm.tsx';
import styles from '../../../_components/EventWriteForm.module.css';

interface EditEventPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isMissingEvent = (data: EventWithOccurrences | null) => data === null;

/**
 * Owner-only Event update and occurrence add/update (Issue #29).
 *
 * Update authority derives from ownership alone - designated catalog
 * creator membership grants nothing here, and an owner who is not a
 * creator still manages their own event. As on the create page, this
 * decides what to render; events / event_occurrences RLS is what decides
 * what persists, so a non-owner reaching this URL directly cannot change
 * anything.
 */
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
  // nextOwnerId is the current owner: this screen never offers an
  // ownership change, and asking canUpdateEvent with the unchanged owner
  // is the same question the RLS policy's WITH CHECK asks.
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

  return (
    <>
      <BackLink href={detailHref}>公演情報に戻る</BackLink>
      <PageHeading>{event.title} を編集</PageHeading>

      <FormSection heading="イベント情報">
        <EventDetailsEditForm eventId={event.id} initialValues={eventDetailsToFormValues(event)} />
      </FormSection>

      <FormSection
        heading="開催期間"
        description="開催期間と公演回の日時を両方とも新しい期間へ移す場合は、まず開催期間を広げてから公演回の日時を編集し、最後に開催期間を正しい範囲へ戻してください。"
      >
        <EventRangeEditForm eventId={event.id} initialValues={eventRangeToFormValues(event)} />
      </FormSection>

      <FormSection heading="公演回">
        {(() => {
          const canDeleteOccurrence = canDeleteEventOccurrence(user?.id ?? null, {
            ownerId: event.ownerId,
          });
          const canCancelOccurrence = canCancelEventOccurrence(user?.id ?? null, {
            ownerId: event.ownerId,
          });
          return occurrences.map((occurrence) => (
            <div key={occurrence.id} className={styles.occurrenceItem}>
              <OccurrenceUpdateForm
                eventId={event.id}
                occurrenceId={occurrence.id}
                label={`${tokyoDateLabel(occurrence.startsAt)} ${occurrenceTimeRangeLabel(
                  occurrence.startsAt,
                  occurrence.endsAt,
                )}`}
                initialValues={occurrenceToFormValues({
                  doorsAtUtc: occurrence.doorsAt,
                  startsAtUtc: occurrence.startsAt,
                  endsAtUtc: occurrence.endsAt,
                })}
              />
              {(canCancelOccurrence || canDeleteOccurrence) && (
                <div className={styles.occurrenceLifecycle}>
                  {canCancelOccurrence && (
                    <OccurrenceCancellationForm
                      eventId={event.id}
                      occurrenceId={occurrence.id}
                      isCanceled={occurrence.canceledAt !== null}
                    />
                  )}
                  {canDeleteOccurrence && (
                    <DeleteOccurrenceForm eventId={event.id} occurrenceId={occurrence.id} />
                  )}
                </div>
              )}
            </div>
          ));
        })()}

        <OccurrenceAddForm eventId={event.id} />
      </FormSection>

      <FormSection heading="このイベントの中止" className={styles.escalatedSpacing}>
        {canCancelEvent(user?.id ?? null, { ownerId: event.ownerId }) && (
          <EventCancellationForm eventId={event.id} isCanceled={event.canceledAt !== null} />
        )}
      </FormSection>

      <FormSection
        heading="このイベントを削除"
        headingClassName={styles.dangerHeading}
        className={styles.escalatedSpacing}
      >
        {canDeleteEvent(user?.id ?? null, { ownerId: event.ownerId }) && (
          <DeleteEventForm eventId={event.id} />
        )}
      </FormSection>
    </>
  );
}
