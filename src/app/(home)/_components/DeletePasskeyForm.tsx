'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_PASSKEY_DELETE_FORM_STATE } from '@/domain/passkey.ts';
import { deletePasskeyAction } from '../_actions/passkeyActions.ts';

export interface DeletePasskeyFormProps {
  passkeyId: string;
  /** The same text PasskeySection renders next to this form
   * (passkeyDisplayLabel's output). Passed through so the delete button's
   * accessible name identifies which passkey it acts on - the visible
   * "削除"/"削除中…" text is identical across every row (Codex finding,
   * PR #129), so a screen reader navigating by button role/name alone
   * cannot otherwise tell them apart, regardless of the PO's decision to
   * allow duplicate visible labels (docs/ux-ui.md's WCAG 2.2 AA
   * baseline). */
  passkeyLabel: string;
}

/** Owner-only-by-construction: auth.passkey.delete() only ever acts on the
 * caller's own session (src/infrastructure/supabase/passkey.ts), so this
 * form has no id-ownership check of its own to get wrong. Mirrors
 * DeleteEventForm (src/app/catalog/_components/DeleteEventForm.tsx) minus
 * the confirm() prompt - unlike deleting an event, revoking one credential
 * among possibly several is low-stakes and reversible by registering again. */
export function DeletePasskeyForm({ passkeyId, passkeyLabel }: DeletePasskeyFormProps) {
  const [state, formAction, isPending] = useActionState(
    deletePasskeyAction,
    INITIAL_PASSKEY_DELETE_FORM_STATE,
  );

  return (
    <form action={formAction} aria-busy={isPending}>
      <input type="hidden" name="passkeyId" value={passkeyId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      <Button
        type="submit"
        variant="secondary"
        disabled={isPending}
        aria-label={isPending ? `${passkeyLabel}を削除中…` : `${passkeyLabel}を削除`}
      >
        {isPending ? '削除中…' : '削除'}
      </Button>
    </form>
  );
}
