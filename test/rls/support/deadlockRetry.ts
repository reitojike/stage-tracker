// Shared by migrationDataPreservation.test.ts and eventRangeBackfill.test.ts
// (Issue #17 / #88): both replay committed migration SQL - including a
// `create table ... references auth.users(id)` - directly against a raw pg
// connection to prove real migration behavior, not a hand-written
// approximation of it. Creating that foreign key takes a lock on auth.users
// that can conflict with concurrent test files' createTestActor/
// deleteTestActor churn on the same table, which can surface as a
// transient Postgres deadlock (SQLSTATE 40P01) - a shared-database
// contention artifact, not a correctness problem in the migration under
// test. Retrying is Postgres's own documented mitigation for this.
//
// Issue #209 isolates these two files into their own serial lane
// (scripts/run-rls-suite.mjs) specifically to remove the concurrent
// auth.users writers this needs another test file for, so this retry is
// now a defense-in-depth fallback (e.g. GoTrue's own background
// housekeeping touching auth.users) rather than the primary mitigation.
//
// `client` is required (not just `run`) because some replayed migrations
// (e.g. 20260821000100_backfill_and_drop_event_temporal_columns.sql,
// 20260825000000_add_event_range.sql) contain an explicit `begin;
// ... commit;` in their SQL text, sent as one `client.query()` call. A
// 40P01 mid-transaction there leaves the connection in a failed-transaction
// block (every statement errors with 25P02 until an explicit rollback), so
// retrying `run()` on the same connection without rolling back first would
// mask the original deadlock behind a confusing 25P02.
export async function withDeadlockRetry<T>(
  client: { query: (text: string) => Promise<unknown> },
  run: () => Promise<T>,
): Promise<T> {
  const ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const isDeadlock =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '40P01';
      if (!isDeadlock || attempt >= ATTEMPTS) {
        throw error;
      }
      await client.query('rollback').catch(() => {});
    }
  }
}
