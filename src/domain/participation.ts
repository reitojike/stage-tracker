// Occurrence-level participation domain model (Issue #33), over the
// persistence/RLS baseline Issue #30 established
// (supabase/migrations/20260822010000_create_occurrence_participations.sql).
//
// Product semantics (see .ai-dev-foundation/product-rules.md,
// "Participation"):
// - Targets an occurrence (公演回), never an event.
// - MVP status vocabulary is exactly `considering` / `attending`.
//   `not_attending` does not exist as a status: the absence of a row means
//   "not participating".
// - Visibility defaults to `private` (owner only); `public` means every
//   authenticated user.
// - Independent of ticket acquisition: nothing here reads or is driven by
//   ticket state.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

export type ParticipationStatus = 'considering' | 'attending';
export type ParticipationVisibility = 'private' | 'public';

export interface Participation {
  id: string;
  occurrenceId: string;
  userId: string;
  status: ParticipationStatus;
  visibility: ParticipationVisibility;
  createdAt: string;
  updatedAt: string;
}

/** What a caller may set when recording their own participation. visibility
 * is optional so a caller can omit it and take the column's `private`
 * default, mirroring how the RLS test fixtures exercise that default. */
export interface ParticipationInput {
  status: ParticipationStatus;
  visibility?: ParticipationVisibility;
}

/**
 * The persistence row shape mapParticipationRow expects. Declared locally
 * rather than importing the generated Database type, matching the
 * convention in domain/eventCatalog.ts's RawEventRow.
 */
export interface RawParticipationRow {
  id: string;
  occurrence_id: string;
  user_id: string;
  status: ParticipationStatus;
  visibility: ParticipationVisibility;
  created_at: string;
  updated_at: string;
}

export function mapParticipationRow(row: RawParticipationRow): Participation {
  return {
    id: row.id,
    occurrenceId: row.occurrence_id,
    userId: row.user_id,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Deterministic ordering: created_at ascending, id as a stable tie-breaker
 * - the same pattern domain/eventCatalog.ts's compareOccurrencesByStartsAt
 * uses for occurrences sharing an instant. */
export function compareParticipationsByCreatedAt(a: Participation, b: Participation): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function sortParticipations(participations: readonly Participation[]): Participation[] {
  return [...participations].sort(compareParticipationsByCreatedAt);
}
