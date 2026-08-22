import { classifyPostgrestError, type PlanningResult } from '../../domain/planningError.ts';

// Shared pagination helper for the MVP personal planning typed boundary
// (Issue #33), mirroring src/infrastructure/supabase/eventCatalogRead.ts's
// private fetchAllRows.
//
// PostgREST caps any single response at supabase/config.toml's
// `api.max_rows` (currently 1000), silently - a request for more rows than
// that just comes back short, with no error and no indication truncation
// happened. A collection read that does a single unranged `.select()` is
// therefore only ever correct by accident, for callers that happen to stay
// under the cap. fetchAllRows paginates with `.range()` and keeps
// requesting pages until the accumulated row count reaches the *reported*
// total (from `count: 'exact'`), rather than assuming "a page shorter than
// what we asked for means we're done" - that assumption breaks if
// max_rows is ever configured below PAGE_SIZE, silently reintroducing the
// same truncation this exists to prevent.
//
// Not reused from eventCatalogRead.ts directly (that copy stays private to
// Issue #12's module, out of this Task's scope to touch) - this is the
// shared implementation every "list" operation added by Issue #33 calls,
// so a fix here does not need to be independently rediscovered per domain.

const PAGE_SIZE = 500;

interface PageResponse<Row> {
  data: Row[] | null;
  error: { message: string; code: string } | null;
  count: number | null;
}

/**
 * Drives an arbitrary `.range(from, to)`-based PostgREST query to
 * completion, accumulating every row regardless of how many pages that
 * takes. `queryPage` must request `{ count: 'exact' }` so a reported total
 * is available - without one, this has no reliable way to distinguish "the
 * last page happened to be short" from "max_rows silently capped this page
 * below what was asked for", so it fails closed (an error result) rather
 * than ever returning a possibly-incomplete page set as success.
 */
export async function fetchAllRows<Row>(
  queryPage: (from: number, to: number) => PromiseLike<PageResponse<Row>>,
): Promise<PlanningResult<Row[]>> {
  const rows: Row[] = [];
  let offset = 0;
  for (;;) {
    const { data, error, count } = await queryPage(offset, offset + PAGE_SIZE - 1);
    if (error !== null) {
      return { ok: false, error: classifyPostgrestError(error) };
    }
    if (count === null) {
      return {
        ok: false,
        error: {
          kind: 'failure',
          message: 'Postgrest did not report a total row count for a paginated query',
          code: 'pagination-count-missing',
        },
      };
    }
    if (data === null) {
      return {
        ok: false,
        error: {
          kind: 'failure',
          message: 'Postgrest returned no data and no error for a paginated query',
          code: 'pagination-data-missing',
        },
      };
    }
    rows.push(...data);
    offset += data.length;
    if (data.length === 0 || offset >= count) {
      break;
    }
  }
  return { ok: true, data: rows };
}
