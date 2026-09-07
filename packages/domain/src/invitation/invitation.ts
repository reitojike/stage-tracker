import { z } from 'zod';
import { occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';

/**
 * Invitation ("招待"): a pending-only coordination record
 * (docs/v2/oracle-domain.md §1.7, AGENTS.md "Invitation", Issue #225/#230).
 * A row's existence *is* the entire state - there is no durable
 * accepted/declined history. Resolution (accept, decline, or "generic
 * attending convergence") deletes the row outright.
 *
 * `declined_at`/`updated_at` from the underlying table are intentionally NOT
 * modeled here (docs/v2/decisions.md A7: both are dead columns that no
 * current write path ever sets - "pending invitation を INSERT / DELETE
 * のみの不変レコードとして設計し直し、両列を持ち越さない"). A pending
 * Invitation is an immutable INSERT/DELETE-only record; it has no
 * update-side lifecycle worth a domain field.
 *
 * `InvitationId` is defined locally rather than in `../ids` per this task's
 * instructions (the parent package wires new id types into the shared
 * module later).
 */
export const invitationIdSchema = z.uuid().brand<'InvitationId'>();
export type InvitationId = z.infer<typeof invitationIdSchema>;

export const invitationSchema = z
  .object({
    id: invitationIdSchema,
    occurrenceId: occurrenceIdSchema,
    inviterId: userIdSchema,
    inviteeId: userIdSchema,
    createdAt: instantSchema,
  })
  .superRefine((invitation, ctx) => {
    if (invitation.inviterId === invitation.inviteeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['inviteeId'],
        message: 'inviterId and inviteeId must differ (self-invite is not allowed).',
      });
    }
  });
export type Invitation = z.infer<typeof invitationSchema>;
