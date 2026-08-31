// Issue #259: shared aggregation for test-file `after()` teardown. Extracted
// from catalogAccess.test.ts so its "run everything, then report every
// failure together" behavior (previously only exercised implicitly via a
// real Chrome/Supabase run) can be proven deterministically against fake
// tasks in test/auth/browserPageHarness.test.ts.

/**
 * Runs every cleanup task to completion, one at a time (not concurrently) -
 * never stops early on a single failure, so e.g. a failing `page.close()`
 * still lets `browser.close()`/`app.stop()`/fixture cleanup run - then
 * throws one aggregate error if any failed.
 *
 * Serial, not `Promise.allSettled(tasks.map(...))`: callers pass
 * dependency-ordered tasks (catalogAccess.test.ts pushes page, then
 * browser, then app), and running them concurrently would race - e.g.
 * `browser.close()` terminating Chrome while `page.close()`'s own CDP
 * `Page.close` round-trip is still in flight on the same WebSocket, which
 * that connection has no path to ever reject, defeating the very
 * bounded-cleanup guarantee this Issue exists to establish. Awaiting each
 * task before starting the next preserves that ordering, at the cost of
 * cleanup no longer running in parallel - acceptable here since every task
 * is itself already bounded (Browser.close()/cleanupFailedLaunch/
 * stopProcess all have their own timeouts).
 *
 * Callers achieve partial-initialization safety by only pushing a thunk for
 * a resource they actually initialized (see catalogAccess.test.ts's
 * `before()`), rather than this function guarding against an `undefined`
 * resource itself - there is nothing here that can throw a secondary
 * `undefined.close()` TypeError, since an uninitialized resource simply has
 * no thunk in the list.
 */
export async function runCleanupTasks(tasks: ReadonlyArray<() => Promise<void>>): Promise<void> {
  const failures: unknown[] = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure instanceof Error ? failure.message : String(failure),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
}
