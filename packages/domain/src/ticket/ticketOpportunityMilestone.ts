import { z } from 'zod';
import { compareInstants, instantSchema } from '../time/instant';
import { tokyoCalendarDateSchema } from '../time/tokyoCalendarDate';
import { ticketOpportunityIdSchema, ticketOpportunityMilestoneIdSchema } from './ids';

/**
 * TicketOpportunityMilestone: one dated event in an Opportunity's own
 * lifecycle (application open/close, result announcement, sale start,
 * payment window - `specs/008-ticket-opportunity-planning/spec.md`).
 *
 * A milestone the source never gave is represented by simply not creating a
 * row - never by a sentinel "unknown" value (Spec 008's rule that a
 * source-absent milestone is represented by no row). That rule lives one level up, in the aggregate
 * that holds `readonly TicketOpportunityMilestone[]` (see
 * ./ticketOpportunityTimeline.ts) - this module only shapes one milestone
 * once it exists.
 *
 * `temporalPrecision` discriminates exactly the shape of information the
 * source gave - a bare date, an exact instant, or a window - and this is
 * modeled as a discriminated union (mirroring the underlying
 * `ticket_opportunity_milestones` table's own CHECK constraint - "精度に
 * 対応する列グループだけが非null") rather
 * than three nullable sibling fields on one flat object. This makes it a
 * type error, not just a runtime possibility, to read `at` off a
 * `date`-precision milestone or to fabricate a time a `date`-precision
 * milestone never had (Spec 008's source-precision rule).
 */

export const ticketOpportunityMilestoneTypeSchema = z.enum([
  'application_open',
  'application_close',
  'result_announcement',
  'sale_start',
  'payment_window',
]);
export type TicketOpportunityMilestoneType = z.infer<typeof ticketOpportunityMilestoneTypeSchema>;

const milestoneCommonFields = {
  id: ticketOpportunityMilestoneIdSchema,
  opportunityId: ticketOpportunityIdSchema,
  milestoneType: ticketOpportunityMilestoneTypeSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
};

const dateMilestoneSchema = z.object({
  ...milestoneCommonFields,
  temporalPrecision: z.literal('date'),
  dateValue: tokyoCalendarDateSchema,
});

const datetimeMilestoneSchema = z.object({
  ...milestoneCommonFields,
  temporalPrecision: z.literal('datetime'),
  at: instantSchema,
});

const windowMilestoneSchema = z.object({
  ...milestoneCommonFields,
  temporalPrecision: z.literal('window'),
  startsAt: instantSchema,
  endsAt: instantSchema,
});

export const ticketOpportunityMilestoneSchema = z
  .discriminatedUnion('temporalPrecision', [
    dateMilestoneSchema,
    datetimeMilestoneSchema,
    windowMilestoneSchema,
  ])
  .superRefine((milestone, ctx) => {
    if (
      milestone.temporalPrecision === 'window' &&
      compareInstants(milestone.startsAt, milestone.endsAt) > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'startsAt must be on or before endsAt for a window-precision milestone.',
      });
    }
  });

export type TicketOpportunityMilestone = z.infer<typeof ticketOpportunityMilestoneSchema>;
export type TicketOpportunityMilestoneTemporalPrecision =
  TicketOpportunityMilestone['temporalPrecision'];
