'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { RawFormValues } from '@/domain/eventCatalogWrite.ts';
import { updateOccurrenceAction } from '../_actions/eventWrite.ts';
import {
  OccurrenceCancellationForm,
  useOccurrenceCancellationAction,
} from './OccurrenceCancellationForm.tsx';
import { DeleteOccurrenceForm, useDeleteOccurrenceAction } from './DeleteOccurrenceForm.tsx';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import { WriteNotice } from '@/ui/WriteNotice';
import styles from './EventWriteForm.module.css';

export interface OccurrenceUpdateFormProps {
  eventId: string;
  occurrenceId: string;
  label: string;
  initialValues: RawFormValues;
  canCancel: boolean;
  canDelete: boolean;
  isCanceled: boolean;
}

/** A compact list-row trigger plus the one-occurrence Sheet. The write and
 * lifecycle forms remain separate, preserving their distinct server actions
 * and confirmation semantics without nesting forms. */
export function OccurrenceUpdateForm({
  eventId,
  occurrenceId,
  label,
  initialValues,
  canCancel,
  canDelete,
  isCanceled,
}: OccurrenceUpdateFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(updateOccurrenceAction, {
    ...INITIAL_WRITE_FORM_STATE,
    values: initialValues,
  });
  const [cancellationState, cancellationFormAction, isCancellationPending] =
    useOccurrenceCancellationAction(isCanceled);
  const [deleteState, deleteFormAction, isDeletePending] = useDeleteOccurrenceAction();
  const formId = `occurrence-update-${occurrenceId}`;
  const closedAttemptRef = useRef<number | null>(null);
  const hasLifecycleFeedback =
    (canCancel && (cancellationState.feedback !== null || cancellationState.notice !== null)) ||
    (canDelete && deleteState.feedback !== null);

  useEffect(() => {
    if (state.notice !== null && closedAttemptRef.current !== state.attempt) {
      closedAttemptRef.current = state.attempt;
      setOpen(false);
    }
  }, [state.attempt, state.notice]);

  return (
    <>
      <Button
        type="button"
        variant="quiet"
        onClick={() => {
          setOpen(true);
        }}
      >
        変更
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        showCloseButton={false}
        footer={
          <div className={styles.sheetFooter}>
            <Button
              type="submit"
              form={formId}
              className={styles.stablePendingButton}
              disabled={isPending}
            >
              <span className={styles.stablePendingLabel}>
                <span aria-hidden="true" className={styles.stablePendingSizing}>
                  この公演回を保存
                </span>
                <span>{isPending ? '保存中…' : 'この公演回を保存'}</span>
              </span>
            </Button>
          </div>
        }
      >
        <form id={formId} action={formAction} className={styles.sheetForm} aria-busy={isPending}>
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="occurrenceId" value={occurrenceId} />
          {state.feedback ? (
            <StatePanel
              key={state.attempt}
              variant={state.feedback.variant}
              title={state.feedback.title}
              description={state.feedback.description}
            />
          ) : null}
          <WriteNotice notice={cancellationState.notice} attempt={cancellationState.attempt} />
          <WriteNotice notice={state.notice} attempt={state.attempt} />
          <div key={state.attempt} className={styles.fields}>
            <OccurrenceFields
              values={state.values}
              fieldErrors={state.fieldErrors}
              disabled={isPending}
              compactHelperText="空欄の開場は未公表、終演は終了時刻未定として扱われます。すべて日本時間（Asia/Tokyo）です。"
            />
          </div>
        </form>
        {canCancel || canDelete ? (
          <div className={styles.sheetLifecycle}>
            <div
              className={[
                styles.sheetLifecycleFeedback,
                !hasLifecycleFeedback ? styles.sheetLifecycleFeedbackEmpty : undefined,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {canCancel && cancellationState.feedback ? (
                <StatePanel
                  key={cancellationState.attempt}
                  variant={cancellationState.feedback.variant}
                  title={cancellationState.feedback.title}
                  description={cancellationState.feedback.description}
                />
              ) : null}
              {canDelete && deleteState.feedback ? (
                <StatePanel
                  key={deleteState.attempt}
                  variant={deleteState.feedback.variant}
                  title={deleteState.feedback.title}
                  description={deleteState.feedback.description}
                />
              ) : null}
            </div>
            <div className={styles.sheetLifecycleActions}>
              {canCancel ? (
                <OccurrenceCancellationForm
                  eventId={eventId}
                  occurrenceId={occurrenceId}
                  isCanceled={isCanceled}
                  formAction={cancellationFormAction}
                  isPending={isCancellationPending}
                />
              ) : null}
              {canDelete ? (
                <DeleteOccurrenceForm
                  eventId={eventId}
                  occurrenceId={occurrenceId}
                  formAction={deleteFormAction}
                  isPending={isDeletePending}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
