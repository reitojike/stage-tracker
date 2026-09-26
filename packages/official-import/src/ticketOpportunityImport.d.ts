import type { TicketOpportunityProposalInput } from './durableCandidate.d.ts';

export interface ValidatedTicketOpportunityEntry {
  readonly eventSourceKey: string;
  readonly sourceKey: string;
  readonly displayName: string;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
  readonly targetScope: 'event_wide' | 'selected_occurrences';
  readonly targetOccurrences: readonly string[];
  readonly milestones: readonly {
    readonly milestone_type: string;
    readonly temporal_precision: 'date' | 'datetime' | 'window';
    readonly date_value?: string;
    readonly at?: string;
    readonly starts_at?: string;
    readonly ends_at?: string;
  }[];
}

export interface ResolvedTicketOpportunityPlan {
  readonly entry: ValidatedTicketOpportunityEntry;
  readonly event: { readonly id: string; readonly title: string };
  readonly hasCanceledTarget: boolean;
  readonly action: 'create' | 'update' | 'unchanged';
  readonly existing: { readonly id: string } | null;
  readonly expectedCurrent: unknown;
  readonly occurrenceIds: readonly string[];
  readonly milestones: readonly unknown[];
  readonly eventChanged: boolean;
  readonly detailsChanged: boolean;
  readonly occurrencesChanged: boolean;
  readonly milestonesChanged: boolean;
}

export function validateSeedEntries(
  rawEntries: readonly {
    readonly raw: TicketOpportunityProposalInput | unknown;
    readonly where: string;
  }[],
):
  | {
      readonly ok: true;
      readonly entries: readonly ValidatedTicketOpportunityEntry[];
    }
  | { readonly ok: false; readonly problems: readonly string[] };

export function resolvePlans(
  admin: unknown,
  entries: readonly ValidatedTicketOpportunityEntry[],
  options?: { readonly targetEventId?: string | null },
): Promise<
  | {
      readonly ok: true;
      readonly plans: readonly ResolvedTicketOpportunityPlan[];
    }
  | { readonly ok: false; readonly problems: readonly string[]; readonly retryable?: boolean }
>;

export function applyPlans(
  admin: unknown,
  plans: readonly ResolvedTicketOpportunityPlan[],
  options?: { readonly reviewed?: boolean },
): Promise<void>;

export class StaleTicketOpportunityCatalogError extends Error {}
