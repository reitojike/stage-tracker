import type { EventProposalInput } from './durableCandidate.d.ts';

export interface ValidatedEventEntry extends EventProposalInput {
  readonly venue: string | null;
  readonly memo: string | null;
  readonly sourceUrl: string | null;
  readonly occurrences: Array<{
    readonly doorsAt: string | null;
    readonly startsAt: string;
    readonly endsAt: string | null;
    readonly instant: number;
  }>;
  readonly classification: {
    readonly genre: string | null | undefined;
    readonly groups: readonly { readonly key: string; readonly displayName: string }[] | undefined;
  };
}

export type EventValidationResult =
  | { readonly ok: true; readonly entries: readonly ValidatedEventEntry[] }
  | { readonly ok: false; readonly problems: readonly string[] };

export interface ResolvedEventPlan {
  readonly entry: ValidatedEventEntry;
  readonly action: 'create' | 'update' | 'unchanged';
  readonly event: { readonly id: string; readonly canceled_at: string | null } | null;
  readonly expectedCurrent: unknown;
  readonly detailsChanged: boolean;
  readonly rangeChanged: boolean;
  readonly newOccurrences: readonly ValidatedEventEntry['occurrences'][number][];
  readonly endsAtFixes: readonly unknown[];
  readonly doorsAtFixes: readonly unknown[];
  readonly keptOccurrences: number;
  readonly genrePlan: {
    readonly changed: boolean;
    readonly setGenre: boolean;
    readonly genreKey: string | null;
  };
  readonly groupsPlan: {
    readonly changed: boolean;
    readonly setGroups: boolean;
    readonly groups: readonly {
      readonly key: string;
      readonly displayName: string;
    }[];
  };
}

export function validateEventEntries(
  rawEntries: readonly { readonly raw: unknown; readonly where: string }[],
): EventValidationResult;

export function resolveEventPlans(
  admin: unknown,
  entries: readonly ValidatedEventEntry[],
  options: {
    readonly owner: { readonly id: string };
    readonly ownerEmail?: string;
    readonly remote?: boolean;
    readonly targetEventIdsBySourceKey?: ReadonlyMap<string, string>;
  },
): Promise<
  | { readonly ok: true; readonly plans: readonly ResolvedEventPlan[] }
  | { readonly ok: false; readonly problems: readonly string[] }
>;

export function applyEventPlans(
  admin: unknown,
  plans: readonly ResolvedEventPlan[],
  options: {
    readonly ownerId: string;
    readonly onApplied?: (sourceKey: string) => void;
    readonly reviewed?: boolean;
  },
): Promise<
  | { readonly ok: true; readonly applied: readonly string[] }
  | {
      readonly ok: false;
      readonly error: string;
      readonly stale: boolean;
      readonly applied: readonly string[];
    }
>;
