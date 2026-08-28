'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_TICKET_OPPORTUNITY_OPERATION_STATE } from '@/domain/ticketOpportunityFeedback.ts';
import type { UserTicketOpportunityStatus } from '@/domain/ticketOpportunity.ts';
import { updateTicketOpportunityStateAction } from '../_actions/ticketOpportunityWrite.ts';
import { TicketOpportunityWriteNotice } from './TicketOpportunityWriteNotice.tsx';
import styles from './TicketOpportunityStateControls.module.css';

export interface TicketOpportunityStateControlsProps {
  opportunityId: string;
  /** The caller's own current state for this Opportunity, or null if not
   * registered as a personal planning target yet (Issue #144: absence of a
   * row is "not registered", not a distinct status). */
  myState: UserTicketOpportunityStatus | null;
}

/**
 * The caller's own quiet planning-state control for one Ticket Opportunity
 * (Issue #144 Task Contract). Rendered on exactly one row per Opportunity
 * (see domain/ticketOpportunityTimeline.ts's isFirstRowForOpportunity) - not
 * a page-level "add" action: personal state can only be set against an
 * existing shared Opportunity, never created from this UI (product-rules.md
 * "Shared / personal authority boundary").
 */
export function TicketOpportunityStateControls({
  opportunityId,
  myState,
}: TicketOpportunityStateControlsProps) {
  const [state, formAction, isPending] = useActionState(
    updateTicketOpportunityStateAction,
    INITIAL_TICKET_OPPORTUNITY_OPERATION_STATE,
  );

  return (
    <form action={formAction} className={styles.form} aria-busy={isPending}>
      <input type="hidden" name="opportunityId" value={opportunityId} />

      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant="error"
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}
      <TicketOpportunityWriteNotice notice={state.notice} attempt={state.attempt} />

      <div className={styles.actions}>
        {myState === null ? (
          <Button type="submit" name="intent" value="planned" variant="quiet" disabled={isPending}>
            申し込む予定にする
          </Button>
        ) : null}
        {myState === 'planned' ? (
          <Button type="submit" name="intent" value="applied" variant="quiet" disabled={isPending}>
            申し込み済みにする
          </Button>
        ) : null}
        {myState === 'applied' ? (
          <Button type="submit" name="intent" value="planned" variant="quiet" disabled={isPending}>
            申し込む予定に戻す
          </Button>
        ) : null}
        {myState !== null ? (
          <Button type="submit" name="intent" value="remove" variant="quiet" disabled={isPending}>
            登録を解除
          </Button>
        ) : null}
      </div>
    </form>
  );
}
