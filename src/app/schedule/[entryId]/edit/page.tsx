import { BackLink } from '@/ui/BackLink';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import { getVisiblePersonalScheduleEntry } from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePlanningReadState } from '@/domain/planningError.ts';
import { resolveWriteFeedback } from '@/domain/personalScheduleWriteFeedback.ts';
import { personalScheduleEntryToFormValues } from '@/domain/personalScheduleWrite.ts';
import type { PersonalScheduleEntry } from '@/domain/personalSchedule.ts';
import { ScheduleEntryEditForm } from '../../_components/ScheduleEntryEditForm.tsx';

interface EditScheduleEntryPageProps {
  params: Promise<{ entryId: string }>;
}

const isMissingEntry = (data: PersonalScheduleEntry | null) => data === null;

/**
 * Owner-only personal schedule entry update (Issue #37). This decides what
 * to render; personal_schedule_entries_update_own RLS is what decides what
 * persists, so a non-owner reaching this URL directly cannot change
 * anything even if this page were wrong - matching the Event edit page's
 * reasoning (src/app/catalog/events/[eventId]/edit/page.tsx).
 *
 * A shared recipient can *read* this entry (wider SELECT policy - see
 * infrastructure/supabase/personalSchedule.ts's deniedEntryUpdate comment)
 * but never reaches an editable form here: ownership alone gates rendering
 * this screen, exactly mirroring the read/write policy gap itself.
 *
 * Identity is resolved via requireAuthenticatedUserId, which distinguishes
 * a genuine auth-check failure from "not signed in" - unlike session.ts's
 * getAuthenticatedUser, which collapses both into `null` and would
 * misreport a transient failure as "not the owner" (see the detail page's
 * identical reasoning at ../page.tsx).
 */
export default async function EditScheduleEntryPage({ params }: EditScheduleEntryPageProps) {
  const { entryId } = await params;
  const detailHref = `/schedule/${entryId}`;

  const client = await createSupabaseServerClient();
  const [result, callerResult] = await Promise.all([
    getVisiblePersonalScheduleEntry(client, entryId),
    requireAuthenticatedUserId(client),
  ]);
  const state = resolvePlanningReadState(result, isMissingEntry);

  if (state === 'error') {
    return (
      <>
        <BackLink href={detailHref}>予定に戻る</BackLink>
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </>
    );
  }

  if (state === 'empty' || !result.ok || result.data === null) {
    return (
      <>
        <BackLink href={detailHref}>予定に戻る</BackLink>
        <StatePanel variant="empty" title="指定された予定が見つかりません" />
      </>
    );
  }

  if (!callerResult.ok) {
    return (
      <>
        <BackLink href={detailHref}>予定に戻る</BackLink>
        <StatePanel
          variant="error"
          title="権限を確認できませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </>
    );
  }

  const entry = result.data;
  const canEdit = entry.ownerId === callerResult.data;

  if (!canEdit) {
    const denial = resolveWriteFeedback('update-schedule-entry', 'permission-denied');
    return (
      <>
        <BackLink href={detailHref}>予定に戻る</BackLink>
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
      <BackLink href={detailHref}>予定に戻る</BackLink>
      <PageHeading>予定を編集</PageHeading>
      <ScheduleEntryEditForm
        entryId={entry.id}
        initialValues={personalScheduleEntryToFormValues({
          scheduleType: entry.scheduleType,
          memo: entry.memo,
          temporal: entry.temporal,
        })}
      />
    </>
  );
}
