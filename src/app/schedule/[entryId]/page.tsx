import { ActionRow } from '@/ui/ActionRow';
import { BackLink } from '@/ui/BackLink';
import { Badge } from '@/ui/Badge';
import { LinkButton } from '@/ui/LinkButton';
import { PageHeading } from '@/ui/PageHeading';
import { StatePanel } from '@/ui/StatePanel';
import { Surface } from '@/ui/Surface';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import { requireAuthenticatedUserId } from '@/infrastructure/supabase/planningAuth.ts';
import {
  getVisiblePersonalScheduleEntry,
  listScheduleShareRecipientEmails,
  listScheduleShares,
} from '@/infrastructure/supabase/personalSchedule.ts';
import { resolvePlanningReadState } from '@/domain/planningError.ts';
import { scheduleTemporalLabel } from '@/domain/personalScheduleFormatting.ts';
import {
  findOwnScheduleShare,
  type PersonalScheduleEntry,
  type ScheduleShareRecipient,
} from '@/domain/personalSchedule.ts';
import { DeleteEntryForm } from '../_components/DeleteEntryForm.tsx';
import { LeaveShareForm } from '../_components/LeaveShareForm.tsx';
import { RemoveRecipientForm } from '../_components/RemoveRecipientForm.tsx';
import { ShareAddForm } from '../_components/ShareAddForm.tsx';
import styles from '../_components/ScheduleDetail.module.css';

interface ScheduleEntryPageProps {
  params: Promise<{ entryId: string }>;
}

const isMissingEntry = (data: PersonalScheduleEntry | null) => data === null;
const isEmptyRecipientList = (data: ScheduleShareRecipient[]) => data.length === 0;

/**
 * Read-only single-entry detail surface, plus owner-side recipient
 * management (Issue #37, over #55's exact-email authenticated-user
 * targeting boundary). A non-existent or not-visible id is a distinct
 * "empty" result (RLS makes the two indistinguishable - see
 * getVisiblePersonalScheduleEntry), never an "error"; a genuine read
 * failure is the reverse (see resolvePlanningReadState).
 *
 * The owner's recipient projection (listScheduleShareRecipientEmails) is
 * bounded to this entry's actual shares only - never a general user
 * directory or lookup surface - and adding a recipient
 * (shareScheduleEntryByEmail) takes an exact registered email, never a raw
 * user id, autocomplete, or search (see #55/PR #57, product-rules.md).
 *
 * Identity is resolved via requireAuthenticatedUserId (which distinguishes
 * a genuine auth failure from "not signed in"), not
 * session.ts's getAuthenticatedUser (which collapses both into `null`).
 * Collapsing them here would fail *open*: a transient auth-check failure
 * for the actual owner would read as "not the owner", and this page would
 * then treat the owner as a recipient and hand back some *other*
 * recipient's share id from ownShareId - see findOwnScheduleShare's own
 * comment for why that is exploitable (the owner's DELETE grant on any
 * recipient's share row would let the "leave" button actually remove
 * someone else's access). A failed identity check is therefore its own
 * explicit error state below, never silently treated as "this caller is a
 * recipient".
 */
export default async function ScheduleEntryPage({ params }: ScheduleEntryPageProps) {
  const { entryId } = await params;

  const client = await createSupabaseServerClient();
  const [result, callerResult] = await Promise.all([
    getVisiblePersonalScheduleEntry(client, entryId),
    requireAuthenticatedUserId(client),
  ]);
  const state = resolvePlanningReadState(result, isMissingEntry);
  const entry = result.ok ? result.data : null;

  let isOwner = false;
  let ownShareId: string | null = null;
  let ownShareReadFailed = false;
  let recipientsResult: Awaited<ReturnType<typeof listScheduleShareRecipientEmails>> | null = null;
  if (entry !== null && callerResult.ok) {
    isOwner = entry.ownerId === callerResult.data;
    if (isOwner) {
      recipientsResult = await listScheduleShareRecipientEmails(client, entry.id);
    } else {
      const shares = await listScheduleShares(client, entry.id);
      // Matched by the caller's confirmed id, not "the first row" - see
      // findOwnScheduleShare's comment. Necessary because the *owner's*
      // read of this table returns every recipient's row, not just one.
      if (shares.ok) {
        ownShareId = findOwnScheduleShare(shares.data, callerResult.data)?.id ?? null;
      } else {
        // A read failure here must not be indistinguishable from "you have
        // no share on this entry" - that would silently hide the
        // self-remove affordance instead of telling the recipient
        // something went wrong (docs/ux-ui.md "Common states").
        ownShareReadFailed = true;
      }
    }
  }
  const recipientsState =
    recipientsResult !== null
      ? resolvePlanningReadState(recipientsResult, isEmptyRecipientList)
      : null;

  return (
    <>
      <BackLink href="/schedule">個人の予定に戻る</BackLink>

      {state === 'error' ? (
        <StatePanel
          variant="error"
          title="予定を読み込めませんでした"
          description="通信状況を確認し、もう一度お試しください。"
        />
      ) : null}
      {state === 'empty' ? (
        <StatePanel variant="empty" title="指定された予定が見つかりません" />
      ) : null}

      {entry !== null ? (
        <>
          <Surface className={styles.scheduleSurface}>
            {callerResult.ok ? (
              <Badge variant="subtle">{isOwner ? '自分の予定' : '共有されている予定'}</Badge>
            ) : null}
            {!entry.blocking ? <Badge variant="outline">予定を確保しない</Badge> : null}
            <PageHeading>{entry.title}</PageHeading>

            <dl className={styles.details}>
              <div className={styles.detailField}>
                <dt className={styles.detailLabel}>期間</dt>
                <dd className={styles.detailValue}>{scheduleTemporalLabel(entry.temporal)}</dd>
              </div>
              {entry.memo !== null ? (
                <div className={styles.detailField}>
                  <dt className={styles.detailLabel}>メモ</dt>
                  <dd className={styles.detailValue}>{entry.memo}</dd>
                </div>
              ) : null}
            </dl>

            {callerResult.ok ? (
              <>
                {isOwner ? (
                  <>
                    <ActionRow>
                      <LinkButton href={`/schedule/${entry.id}/edit`} variant="secondary">
                        編集する
                      </LinkButton>
                    </ActionRow>
                    <DeleteEntryForm entryId={entry.id} />
                  </>
                ) : null}
                {!isOwner && ownShareReadFailed ? (
                  <StatePanel
                    variant="error"
                    title="共有状態を確認できませんでした"
                    description="通信状況を確認し、もう一度お試しください。"
                  />
                ) : null}
                {!isOwner && ownShareId !== null ? <LeaveShareForm shareId={ownShareId} /> : null}
              </>
            ) : (
              <StatePanel
                variant="error"
                title="権限を確認できませんでした"
                description="通信状況を確認し、もう一度お試しください。"
              />
            )}
          </Surface>

          {callerResult.ok && isOwner ? (
            <>
              <Surface className={styles.shareSurface}>
                <section className={styles.section}>
                  <h2 className={styles.sectionHeading}>共有</h2>

                  {recipientsState === 'error' ? (
                    <StatePanel
                      variant="error"
                      title="共有中の共有相手を読み込めませんでした"
                      description="通信状況を確認し、もう一度お試しください。"
                    />
                  ) : null}
                  {recipientsState === 'empty' ? (
                    <StatePanel variant="empty" title="まだ誰とも共有していません" />
                  ) : null}
                  {recipientsResult?.ok && recipientsResult.data.length > 0 ? (
                    <ul className={styles.recipientList}>
                      {recipientsResult.data.map((recipient) => (
                        <li key={recipient.shareId}>
                          <RemoveRecipientForm
                            entryId={entry.id}
                            shareId={recipient.shareId}
                            recipientEmail={recipient.recipientEmail}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              </Surface>

              <Surface className={styles.shareAddSurface}>
                <ShareAddForm entryId={entry.id} />
              </Surface>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
