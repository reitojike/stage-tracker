import Link from 'next/link';
import { StatePanel } from '@/ui/StatePanel';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { getAuthenticatedUser } from '@/infrastructure/supabase/session.ts';
import { getVisiblePersonalScheduleEntry } from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePersonalScheduleReadState } from '@/domain/personalScheduleReadState.ts';
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
 */
export default async function EditScheduleEntryPage({ params }: EditScheduleEntryPageProps) {
  const { entryId } = await params;
  const detailHref = `/schedule/${entryId}`;

  const client = await createSupabaseServerClient();
  const [result, user] = await Promise.all([
    getVisiblePersonalScheduleEntry(client, entryId),
    getAuthenticatedUser(),
  ]);
  const state = resolvePersonalScheduleReadState(result, isMissingEntry);

  if (state === 'error') {
    return (
      <main>
        <Link href={detailHref}>← 予定に戻る</Link>
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      </main>
    );
  }

  if (state === 'empty' || !result.ok || result.data === null) {
    return (
      <main>
        <Link href={detailHref}>← 予定に戻る</Link>
        <StatePanel variant="empty" title="指定された予定が見つかりません" />
      </main>
    );
  }

  const entry = result.data;
  const canEdit = user !== null && entry.ownerId === user.id;

  if (!canEdit) {
    const denial = resolveWriteFeedback('update-schedule-entry', 'permission-denied');
    return (
      <main>
        <Link href={detailHref}>← 予定に戻る</Link>
        <StatePanel
          variant={denial.variant}
          title={denial.title}
          description={denial.description}
        />
      </main>
    );
  }

  return (
    <main>
      <Link href={detailHref}>← 予定に戻る</Link>
      <h1>予定を編集</h1>
      <ScheduleEntryEditForm
        entryId={entry.id}
        initialValues={personalScheduleEntryToFormValues({
          scheduleType: entry.scheduleType,
          memo: entry.memo,
          temporal: entry.temporal,
        })}
      />
    </main>
  );
}
