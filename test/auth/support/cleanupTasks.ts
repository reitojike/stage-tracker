// Issue #259: shared aggregation for test-file `after()` teardown. Extracted
// from catalogAccess.test.ts so its "run everything, then report every
// failure together" behavior (previously only exercised implicitly via a
// real Chrome/Supabase run) can be proven deterministically against fake
// tasks in test/auth/browserPageHarness.test.ts.

/**
 * Runs every task in `tasks` to completion, one at a time (not
 * concurrently) - never stops early on a single failure, so e.g. a failing
 * `page.close()` still lets `browser.close()`/`app.stop()` run - and
 * returns every failure reason collected (an empty array if all succeeded)
 * rather than throwing.
 *
 * Serial, not `Promise.allSettled(tasks.map(...))`: callers pass
 * dependency-ordered tasks (catalogAccess.test.ts pushes page, then
 * browser, then app), and running them concurrently would race - e.g.
 * `browser.close()` terminating Chrome while `page.close()`'s own CDP
 * `Page.close` round-trip is still in flight on the same WebSocket, which
 * that connection has no path to ever reject, defeating the very
 * bounded-cleanup guarantee this Issue exists to establish. Awaiting each
 * task before starting the next preserves that ordering, at the cost of
 * cleanup no longer running in parallel - acceptable since `browser.close()`/
 * `cleanupFailedLaunch`/`stopProcess` are all themselves bounded. (`page.close()`'s
 * own CDP round-trip is a known, tracked exception - not yet bounded -
 * deliberately out of this Issue's scope.)
 *
 * Callers achieve partial-initialization safety by only pushing a thunk for
 * a resource they actually initialized (see catalogAccess.test.ts's
 * `before()`), rather than this function guarding against an `undefined`
 * resource itself - there is nothing here that can throw a secondary
 * `undefined.close()` TypeError, since an uninitialized resource simply has
 * no thunk in the list.
 *
 * Returns raw failures (rather than an already-formatted aggregate error)
 * so a caller merging failures from more than one task group - e.g.
 * catalogAccess.test.ts's `after()`, which also has an independent,
 * concurrently-run fixture-cleanup group - can combine every raw reason
 * into a single aggregate error itself, instead of nesting an
 * already-"cleanup failed:"-prefixed message inside another one.
 */
export async function collectCleanupFailures(
  tasks: ReadonlyArray<() => Promise<void>>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

/** `collectCleanupFailures`, but throws one aggregate error instead of
 * returning the raw failures - for a caller with only a single task group
 * and no further failures to merge in. */
export async function runCleanupTasks(tasks: ReadonlyArray<() => Promise<void>>): Promise<void> {
  const failures = await collectCleanupFailures(tasks);
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure instanceof Error ? failure.message : String(failure),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
}
