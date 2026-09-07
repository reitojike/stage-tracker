import { z } from 'zod';

/**
 * Opaque, branded identifiers for the TicketOpportunity sub-domain
 * (AGENTS.md "Ticket Opportunity（Ticket planning MVP）", docs/v2/
 * oracle-domain.md §1.9). Defined here rather than in the shared `../ids.ts`
 * for the same directory-boundary reason as ../schedule/ids.ts.
 */

export const ticketOpportunityIdSchema = z.uuid().brand<'TicketOpportunityId'>();
export type TicketOpportunityId = z.infer<typeof ticketOpportunityIdSchema>;

export const ticketOpportunityMilestoneIdSchema = z.uuid().brand<'TicketOpportunityMilestoneId'>();
export type TicketOpportunityMilestoneId = z.infer<typeof ticketOpportunityMilestoneIdSchema>;

export const userTicketOpportunityStateIdSchema = z.uuid().brand<'UserTicketOpportunityStateId'>();
export type UserTicketOpportunityStateId = z.infer<typeof userTicketOpportunityStateIdSchema>;
