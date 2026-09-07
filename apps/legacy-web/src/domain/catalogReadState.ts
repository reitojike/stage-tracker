import type { EventCatalogReadResult } from './eventCatalog.ts';

// Pure classification of a typed catalog read (Issue #12's
// EventCatalogReadResult) into the UI state the Catalog feature (Issue #20)
// must render distinctly (docs/ux-ui.md "Common states"): a read failure
// (RLS/auth/network) must never be presented the same way as a successful
// read that simply found nothing. Both src/app/catalog/page.tsx and the
// event detail page compose this instead of re-deriving the ok/empty
// branch inline, so the distinction is proven once here rather than by
// reading component markup.

export type CatalogReadStateKind = 'error' | 'empty' | 'populated';

export function resolveCatalogReadState<T>(
  result: EventCatalogReadResult<T>,
  isEmpty: (data: T) => boolean,
): CatalogReadStateKind {
  if (!result.ok) {
    return 'error';
  }
  return isEmpty(result.data) ? 'empty' : 'populated';
}
