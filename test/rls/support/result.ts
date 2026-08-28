import assert from 'node:assert/strict';

// Shared unwrap helper for the discriminated `{ok:true,data:T}|{ok:false,
// error:unknown}` result shape returned by every typed read boundary in
// this codebase (EventCatalogReadResult, PlanningResult, ...). Extracted
// here so RLS test files share one implementation rather than each
// re-deriving the same few lines (test/rls/eventCatalogRead.test.ts and
// test/rls/eventClassification.test.ts both needed it first).
//
// assert.ok's `asserts` signature narrows `result` at the call site, so
// every caller works with the returned `data` directly with no leftover
// optional chaining or re-checking of `.ok`.
export function requireOk<T>(result: { ok: true; data: T } | { ok: false; error: unknown }): T {
  assert.ok(
    result.ok,
    `expected ok:true, got error: ${JSON.stringify('error' in result ? result.error : null)}`,
  );
  return result.data;
}
