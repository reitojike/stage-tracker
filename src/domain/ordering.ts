// Shared deterministic-ordering helper for the MVP personal planning typed
// read/write boundary (Issue #33). Every list read across participation,
// invitation, personal schedule, ticket acquisition, ticket, and ticket
// transfer needs the same shape of comparator: order by one comparable
// field ascending, and fall back to `id` as a stable tie-breaker for rows
// that share that field's value - the same pattern domain/eventCatalog.ts's
// compareOccurrencesByStartsAt established for occurrences. This module
// exists so those six call sites share one implementation instead of each
// re-deriving it.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

export interface Identified {
  id: string;
}

/**
 * `field` extracts the comparable value each domain orders by (e.g.
 * createdAt, or - for personal schedule entries - whichever of the two
 * temporal shapes' own start field applies). Ties (equal field values) are
 * broken by `id`, and equal ids compare equal - never returned by this
 * module's callers for genuinely distinct rows, but kept exact rather than
 * assumed.
 */
export function compareByFieldThenId<T extends Identified>(
  a: T,
  b: T,
  field: (item: T) => string,
): number {
  const fieldA = field(a);
  const fieldB = field(b);
  if (fieldA !== fieldB) {
    return fieldA < fieldB ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

export function sortByFieldThenId<T extends Identified>(
  items: readonly T[],
  field: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => compareByFieldThenId(a, b, field));
}
