import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllRows } from '../pagedFetch.ts';

// Focused regression test for fetchAllRows (Issue #55, P2 review finding on
// PR #57): listScheduleShareRecipientEmails did a single unranged
// client.rpc(...) call, which PostgREST silently caps at supabase/
// config.toml's api.max_rows (1000) - an owner with more than max_rows
// recipients on one schedule entry would have this truncated with no error
// and no indication anything was missing. It now goes through this same
// fetchAllRows helper every other collection read in the personal
// planning typed boundary already uses (listVisiblePersonalSchedule,
// listScheduleShares), the first time it backs an RPC read
// (client.rpc(...).range(...)) rather than a plain table read
// (client.from(...).range(...)).
//
// fetchAllRows.queryPage is a plain (from, to) => PromiseLike<PageResponse>
// callback, independent of the Supabase client shape - so this exercises
// the exact pagination/accumulation logic listScheduleShareRecipientEmails
// relies on without needing a real database or a fake SupabaseClient
// (typechecking listScheduleShareRecipientEmails's own client.rpc(...)
// .range(...) wiring against the generated Database types already proves
// that call shape compiles; test/rls/typedBoundaryPersonalSchedule.test.ts
// proves the real RPC's positive/negative paths end-to-end).

interface Row {
  id: number;
}

/** Simulates a PostgREST-capped backend: every page is capped at
 * `serverPageCap` regardless of how wide a range the caller requested -
 * the same silent truncation api.max_rows performs. */
function serverCappedPage(total: number, serverPageCap: number) {
  const requestedRanges: Array<{ from: number; to: number }> = [];
  const queryPage = (from: number, to: number) => {
    requestedRanges.push({ from, to });
    const requestedWidth = to - from + 1;
    const pageWidth = Math.min(requestedWidth, serverPageCap, Math.max(total - from, 0));
    const data: Row[] = Array.from({ length: pageWidth }, (_, i) => ({ id: from + i }));
    return Promise.resolve({ data, error: null, count: total });
  };
  return { queryPage, requestedRanges };
}

void test('fetchAllRows accumulates every row across multiple pages, not just the first server-capped page', async () => {
  const TOTAL = 1200;
  const SERVER_PAGE_CAP = 1000; // stands in for api.max_rows
  const { queryPage, requestedRanges } = serverCappedPage(TOTAL, SERVER_PAGE_CAP);

  const result = await fetchAllRows(queryPage);

  assert.equal(result.ok, true);
  assert.equal(result.data.length, TOTAL, 'expected every row, not just the first page');
  assert.deepEqual(
    result.data.map((r) => r.id),
    Array.from({ length: TOTAL }, (_, i) => i),
  );
  assert.ok(
    requestedRanges.length > 1,
    'expected more than one .range() request - a single unranged request is exactly the bug this guards against',
  );
});

void test('fetchAllRows returns an empty list after exactly one request when there are no rows', async () => {
  const { queryPage, requestedRanges } = serverCappedPage(0, 1000);

  const result = await fetchAllRows(queryPage);

  assert.deepEqual(result, { ok: true, data: [] });
  assert.equal(requestedRanges.length, 1);
});

void test('fetchAllRows uses the provided classifyError override, not classifyPostgrestError, for an RPC-style error', async () => {
  const queryPage = () =>
    Promise.resolve({
      data: null,
      error: { message: 'only the schedule entry owner can view recipient emails', code: 'P0001' },
      count: null,
    });

  const result = await fetchAllRows(queryPage, (error) =>
    error.message.includes('only the schedule entry owner')
      ? { kind: 'permission-denied' as const, message: error.message, code: error.code }
      : { kind: 'failure' as const, message: error.message, code: error.code },
  );

  assert.equal(result.ok, false);
  assert.equal(
    result.error.kind,
    'permission-denied',
    'expected the P0001 raise-exception message to classify via the override, not fall through to the default table-error classifier',
  );
});
