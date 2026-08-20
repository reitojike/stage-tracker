// Event catalog permission matrix (PR B / Issue #3). Mirrors the RLS
// policies in supabase/migrations/20260820000000_create_events.sql so the
// same product judgment exists outside the database as well, independent of
// UI/Supabase client/infrastructure code.

/** An authenticated user's id, or null for an anonymous caller. */
export type Actor = string | null;

export interface EventRecord {
  ownerId: string;
}

/** Event catalog rows are readable by any authenticated user, not anonymous callers. */
export function canReadEventCatalog(actor: Actor): boolean {
  return actor !== null;
}

/** The persisted owner_id of a newly created event must equal the creating actor. */
export function canCreateEvent(actor: Actor, ownerId: string): boolean {
  return actor !== null && actor === ownerId;
}

/**
 * Only the current owner may update an event, and ownership itself is not
 * transferable: nextOwnerId must stay equal to the event's current owner.
 */
export function canUpdateEvent(actor: Actor, current: EventRecord, nextOwnerId: string): boolean {
  return actor !== null && actor === current.ownerId && nextOwnerId === current.ownerId;
}
