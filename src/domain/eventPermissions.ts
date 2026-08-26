// Event catalog permission matrix (PR B / Issue #3, extended by Issue #29).
// Mirrors the RLS policies and grants in supabase/migrations/ so the same
// product judgment exists outside the database as well, independent of
// UI/Supabase client/infrastructure code.
//
// This module never *replaces* the database as the enforcement boundary -
// RLS, column grants and the create RPC's own membership check are what
// actually decide what persists. What lives here is the same judgment in a
// form the UI can consult before offering an affordance, and that tests
// can pin without a database.

/** An authenticated user's id, or null for an anonymous caller. */
export type Actor = string | null;

export interface EventRecord {
  ownerId: string;
}

/**
 * Whether the acting user holds designated catalog creator membership
 * (public.catalog_creators). Passed as a named field rather than a bare
 * positional boolean so a call site states which permission it is
 * asserting.
 */
export interface CatalogCreatorStatus {
  isDesignatedCatalogCreator: boolean;
}

/**
 * The parent-event ids an occurrence update would move between. Kept
 * explicit because "an occurrence is never reassigned to a different
 * event" is a distinct invariant from ownership, enforced by its own layer
 * (event_id carries no UPDATE grant).
 */
export interface EventOccurrenceUpdate {
  currentEventId: string;
  nextEventId: string;
}

/** Event catalog rows are readable by any authenticated user, not anonymous callers. */
export function canReadEventCatalog(actor: Actor): boolean {
  return actor !== null;
}

/**
 * Creating a shared catalog entry requires designated catalog creator
 * membership (Issue #29 / product-rules.md "MVP Event catalog write
 * boundary") in addition to the existing rule that the persisted owner_id
 * of a newly created event must equal the creating actor. Membership does
 * not weaken that second requirement: a designated creator still cannot
 * create an event owned by someone else.
 */
export function canCreateEvent(
  actor: Actor,
  ownerId: string,
  status: CatalogCreatorStatus,
): boolean {
  return actor !== null && actor === ownerId && status.isDesignatedCatalogCreator;
}

/**
 * Only the current owner may update an event, and ownership itself is not
 * transferable: nextOwnerId must stay equal to the event's current owner.
 *
 * Designated catalog creator membership is deliberately not consulted
 * here. Update authority derives from ownership alone, so an owner who is
 * not (or is no longer) a designated creator keeps managing their own
 * events, and a designated creator gains no authority over anyone else's.
 */
export function canUpdateEvent(actor: Actor, current: EventRecord, nextOwnerId: string): boolean {
  return actor !== null && actor === current.ownerId && nextOwnerId === current.ownerId;
}

/**
 * Occurrences have no owner of their own: authority derives from the
 * parent event's owner. As with canUpdateEvent, creator membership is not
 * consulted - an event owner manages their own event's occurrences.
 */
export function canCreateEventOccurrence(actor: Actor, parent: EventRecord): boolean {
  return actor !== null && actor === parent.ownerId;
}

/**
 * Parent-event ownership, plus the invariant that an occurrence is never
 * moved to a different event (product-rules.md: 公演回を別の event へ
 * 付け替える operation は提供しません).
 */
export function canUpdateEventOccurrence(
  actor: Actor,
  parent: EventRecord,
  update: EventOccurrenceUpdate,
): boolean {
  return actor !== null && actor === parent.ownerId && update.nextEventId === update.currentEventId;
}

/**
 * Hard delete of an occurrence (Issue #124): owner-only, mis-registration
 * correction (not cancellation). Authority derives from the parent event's
 * ownership.
 */
export function canDeleteEventOccurrence(actor: Actor, parent: EventRecord): boolean {
  return actor !== null && actor === parent.ownerId;
}

/**
 * Hard delete of an event (Issue #124): owner-only, mis-registration
 * correction (not cancellation). Ownership is immutable so checking current
 * event owner is sufficient.
 */
export function canDeleteEvent(actor: Actor, event: EventRecord): boolean {
  return actor !== null && actor === event.ownerId;
}
