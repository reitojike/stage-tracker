import { z } from 'zod';
import { eventIdSchema, occurrenceIdSchema, userIdSchema } from '../ids';
import { instantSchema } from '../time/instant';
import { ticketOpportunityIdSchema, userTicketOpportunityStateIdSchema } from './ids';

/**
 * TicketOpportunity domain model (AGENTS.md "Ticket Opportunity（Ticket
 * planning MVP）", docs/v2/oracle-domain.md §1.9, PO decision Issue #157).
 * Scope is deliberately narrow: "いつ、何の抽選・先行・販売開始があるのか
 * を漏らさず見られる" - not a full application-tracking/inventory model
 * (Issue #162, #234's removal of the old acquired-ticket model).
 *
 * This module is pure domain logic: no I/O, no clock access (see AGENTS.md
 * 設計方針 / docs/v2/decisions.md A6) - "now" is always a caller-supplied
 * parameter wherever a computation needs it (see ./ticketOpportunityTimeline.ts).
 */

export const ticketOpportunityTargetScopeSchema = z.enum(['event_wide', 'selected_occurrences']);
export type TicketOpportunityTargetScope = z.infer<typeof ticketOpportunityTargetScopeSchema>;

/**
 * TicketOpportunity: a single sales/lottery opportunity against one Event.
 * `displayName` preserves the source's own vocabulary (e.g. "FC先行")
 * rather than normalizing into a closed enum - see AGENTS.md "source 上の
 * display name をそのまま保持し、`FC先行` 等の source 固有名称を premature
 * な closed enum へ潰さない". `sourceKey` is a distinct identity space from
 * the parent Event's own `source_key` (docs/v2/oracle-domain.md §1.9).
 */
export const ticketOpportunitySchema = z.object({
  id: ticketOpportunityIdSchema,
  eventId: eventIdSchema,
  targetScope: ticketOpportunityTargetScopeSchema,
  displayName: z.string().min(1),
  sourceKey: z.string().min(1),
  sourceUrl: z.string().nullable(),
  memo: z.string().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export type TicketOpportunity = z.infer<typeof ticketOpportunitySchema>;

/**
 * TicketOpportunity + its explicit target Occurrence set.
 *
 * `event_wide` is a semantic fact about the whole Event, not a snapshot of
 * whichever Occurrences exist right now (AGENTS.md "`event_wide` は Event
 * 全体という semantic fact であり、その時点で存在する Occurrence 一覧の
 * snapshot へ暗黙変換しません") - so an `event_wide` Opportunity must never
 * carry target Occurrence ids, and this schema enforces that as a
 * structural invariant rather than leaving it to callers to remember.
 * `selected_occurrences`, symmetrically, must specify at least one target
 * (the import RPC itself rejects a `selected_occurrences` request with zero
 * occurrence ids - docs/v2/oracle-database.md §3.5).
 */
export const ticketOpportunityWithTargetsSchema = z
  .object({
    opportunity: ticketOpportunitySchema,
    targetOccurrenceIds: z.array(occurrenceIdSchema),
  })
  .superRefine((value, ctx) => {
    if (value.opportunity.targetScope === 'event_wide' && value.targetOccurrenceIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetOccurrenceIds'],
        message: 'an event_wide opportunity must not carry target occurrences.',
      });
    }
    if (
      value.opportunity.targetScope === 'selected_occurrences' &&
      value.targetOccurrenceIds.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetOccurrenceIds'],
        message: 'a selected_occurrences opportunity must specify at least one target occurrence.',
      });
    }
  });

export type TicketOpportunityWithTargets = z.infer<typeof ticketOpportunityWithTargetsSchema>;

export const userTicketOpportunityStatusSchema = z.enum(['planned', 'applied']);
export type UserTicketOpportunityStatus = z.infer<typeof userTicketOpportunityStatusSchema>;

/**
 * UserTicketOpportunityState: personal, owner-only planning state. Absence
 * of a row is the only representation of "not registered as a personal
 * planning target" - it is not an application record (AGENTS.md "行が無い
 * = その Opportunity を personal planning 対象として登録していない、という
 * 意味です。actual application record ではありません").
 */
export const userTicketOpportunityStateSchema = z.object({
  id: userTicketOpportunityStateIdSchema,
  userId: userIdSchema,
  opportunityId: ticketOpportunityIdSchema,
  status: userTicketOpportunityStatusSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

export type UserTicketOpportunityState = z.infer<typeof userTicketOpportunityStateSchema>;
