export type OfficialImportReviewStatus =
  "pending" | "blocked_for_identity_review";

export type OfficialImportApplyStatus = "not_started" | "queued" | "failed";

export type OfficialImportApplyFailureClassification =
  | "validation"
  | "identity_ambiguous"
  | "source_changed"
  | "target_missing"
  | "write_conflict"
  | "provider_unavailable"
  | "policy_blocked"
  | "unexpected";

export interface EventReviewProposal {
  readonly kind: "event";
  readonly sourceKey: string;
  readonly title: string;
  readonly venue: string | null;
  readonly memo: string | null;
  readonly sourceUrl: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly occurrences: readonly {
    readonly doorsAt: string | null;
    readonly startsAt: string;
    readonly endsAt: string | null;
  }[];
  readonly genre: string | null;
  readonly groups: readonly {
    readonly key: string;
    readonly displayName: string;
  }[];
}

export interface TicketOpportunityReviewProposal {
  readonly kind: "ticket_opportunity";
  readonly eventSourceKey: string;
  readonly sourceKey: string;
  readonly displayName: string;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
  readonly targetScope: "event_wide" | "selected_occurrences";
  readonly targetOccurrences: readonly string[];
  readonly milestones: readonly (
    | {
        readonly type: string;
        readonly precision: "date";
        readonly date: string;
      }
    | {
        readonly type: string;
        readonly precision: "datetime";
        readonly at: string;
      }
    | {
        readonly type: string;
        readonly precision: "window";
        readonly startsAt: string;
        readonly endsAt: string;
      }
  )[];
}

export interface CurrentEventReviewTarget {
  readonly id: string;
  readonly sourceKey: string | null;
  readonly title: string;
  readonly venue: string | null;
  readonly memo: string | null;
  readonly sourceUrl: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly occurrences: readonly EventReviewOccurrence[];
}

export interface EventReviewOccurrence {
  readonly id?: string;
  readonly doorsAt: string | null;
  readonly startsAt: string;
  readonly endsAt: string | null;
}

export interface CurrentTicketOpportunityReviewTarget {
  readonly id: string;
  readonly eventId: string;
  readonly currentEvent: {
    readonly id: string;
    readonly sourceKey: string | null;
    readonly title: string;
  };
  readonly sourceKey: string;
  readonly displayName: string;
  readonly sourceUrl: string | null;
  readonly memo: string | null;
  readonly targetScope: string;
  readonly targetOccurrences: readonly string[];
  readonly milestones: TicketOpportunityReviewProposal["milestones"];
}

export interface OfficialImportReviewCandidate {
  readonly id: string;
  readonly kind: "event" | "ticket_opportunity";
  readonly sourceId: string;
  readonly canonicalUrl: string;
  readonly observedAt: string;
  readonly officialExternalId: string | null;
  readonly reviewStatus: OfficialImportReviewStatus | "approved";
  readonly applyStatus: OfficialImportApplyStatus;
  readonly applyFailureClassification: OfficialImportApplyFailureClassification | null;
  readonly applyLeaseExpiresAt: string | null;
  readonly proposal: EventReviewProposal | TicketOpportunityReviewProposal;
  readonly currentEvent: CurrentEventReviewTarget | null;
  readonly currentTicketOpportunity: CurrentTicketOpportunityReviewTarget | null;
  readonly plan: {
    readonly action: "create" | "update" | "unchanged";
    readonly changes: readonly string[];
  };
  readonly evidence: {
    readonly pdfPageNumber?: number;
    readonly sectionLabel?: string;
    readonly rowLabel?: string;
    readonly fragmentId?: string;
  };
  readonly match: {
    readonly deterministicStatus:
      "unresolved" | "matched" | "unmatched" | "ambiguous";
    readonly semanticStatus:
      "not_used" | "matched" | "unmatched" | "ambiguous" | "low_confidence";
    readonly jev: {
      readonly provider: string;
      readonly model: string;
      readonly choice: string;
      readonly confidence?: number;
    } | null;
  };
  readonly blockedReason: string | null;
}
