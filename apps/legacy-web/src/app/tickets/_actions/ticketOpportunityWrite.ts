'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import {
  removeMyTicketOpportunityState,
  setMyTicketOpportunityState,
} from '@/infrastructure/supabase/ticketOpportunity.ts';
import type { UserTicketOpportunityStatus } from '@/domain/ticketOpportunity.ts';
import {
  acceptedTicketOpportunityOperationState,
  rejectedTicketOpportunityOperationState,
  resolveTicketOpportunityOperationFeedback,
  resolveTicketOpportunityOperationFeedbackForError,
  resolveTicketOpportunityStateSetNotice,
  ticketOpportunityRemoveNotice,
  type TicketOpportunityOperationState,
} from '@/domain/ticketOpportunityFeedback.ts';
import { readId } from './formHelpers.ts';

// The only mutation /tickets performs (Issue #144 Task Contract): setting or
// removing the caller's own personal Ticket Opportunity planning state
// (`planned` / `applied` / no row). This never touches the shared
// TicketOpportunity/milestone data itself - that stays read-only from this
// UI (see src/infrastructure/supabase/ticketOpportunity.ts's own header: the
// only write path for shared data is the service_role-only
// import_ticket_opportunity RPC, Issue #163's scope).

type TicketOpportunityIntent = 'planned' | 'applied' | 'remove';

function isTicketOpportunityIntent(value: string | null): value is TicketOpportunityIntent {
  return value === 'planned' || value === 'applied' || value === 'remove';
}

/**
 * Sets or removes the caller's own planning state for one Opportunity. One
 * action serves all transitions (no row -> planned, planned -> applied,
 * applied -> planned, either -> removed) so the Opportunity's controls stay
 * a single <form> with several submit buttons - the same shape
 * updateParticipationAction (src/app/catalog/_actions/participationWrite.ts)
 * uses for its own multi-intent participation form.
 */
export async function updateTicketOpportunityStateAction(
  previous: TicketOpportunityOperationState,
  formData: FormData,
): Promise<TicketOpportunityOperationState> {
  const opportunityId = readId(formData, 'opportunityId');
  const intentRaw = formData.get('intent');
  const intent = typeof intentRaw === 'string' ? intentRaw : null;

  if (opportunityId === null || !isTicketOpportunityIntent(intent)) {
    return rejectedTicketOpportunityOperationState(
      previous,
      resolveTicketOpportunityOperationFeedback('set-ticket-opportunity-state', 'failure'),
    );
  }

  const client = await createSupabaseServerClient();

  if (intent === 'remove') {
    const result = await removeMyTicketOpportunityState(client, opportunityId);
    if (!result.ok) {
      return rejectedTicketOpportunityOperationState(
        previous,
        resolveTicketOpportunityOperationFeedbackForError(
          'remove-ticket-opportunity-state',
          result.error,
        ),
      );
    }
    revalidatePath('/tickets');
    return acceptedTicketOpportunityOperationState(previous, ticketOpportunityRemoveNotice());
  }

  const status: UserTicketOpportunityStatus = intent;
  const result = await setMyTicketOpportunityState(client, opportunityId, status);
  if (!result.ok) {
    return rejectedTicketOpportunityOperationState(
      previous,
      resolveTicketOpportunityOperationFeedbackForError(
        'set-ticket-opportunity-state',
        result.error,
      ),
    );
  }
  revalidatePath('/tickets');
  return acceptedTicketOpportunityOperationState(
    previous,
    resolveTicketOpportunityStateSetNotice(status),
  );
}
