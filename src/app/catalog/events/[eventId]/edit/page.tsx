import { BackLink } from '@/ui/BackLink';
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

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>イベント情報</h2>
        <EventDetailsEditForm eventId={event.id} initialValues={eventDetailsToFormValues(event)} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>開催期間</h2>
        <p className={styles.occurrenceCaption}>
          開催期間と公演回の日時を両方とも新しい期間へ移す場合は、まず開催期間を広げてから公演回の日時を編集し、最後に開催期間を正しい範囲へ戻してください。
        </p>
        <EventRangeEditForm eventId={event.id} initialValues={eventRangeToFormValues(event)} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>公演回</h2>

        {(() => {
          const canDeleteOccurrence = canDeleteEventOccurrence(user?.id ?? null, {
            ownerId: event.ownerId,
          });
          return occurrences.map((occurrence) => (
            <div key={occurrence.id}>
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
              {canDeleteOccurrence && (
                <DeleteOccurrenceForm eventId={event.id} occurrenceId={occurrence.id} />
              )}
            </div>
          ));
        })()}

        <OccurrenceAddForm eventId={event.id} />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>このイベントを削除</h2>
        {canDeleteEvent(user?.id ?? null, { ownerId: event.ownerId }) && (
          <DeleteEventForm eventId={event.id} />
        )}
      </section>
    </>
  );
}
