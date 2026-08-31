// Issue #259: shared aggregation for test-file `after()` teardown. Extracted
// from catalogAccess.test.ts so its "run everything, then report every
// failure together" behavior (previously only exercised implicitly via a
// real Chrome/Supabase run) can be proven deterministically against fake
// tasks in test/auth/browserPageHarness.test.ts.

/**
 * Runs every cleanup task to completion - never stops early on a single
 * failure, so e.g. a failing `page.close()` still lets `browser.close()`/
 * `app.stop()`/fixture cleanup run - then throws one aggregate error if any
 * failed.
 *
 * Callers achieve partial-initialization safety by only pushing a thunk for
 * a resource they actually initialized (see catalogAccess.test.ts's
 * `before()`), rather than this function guarding against an `undefined`
 * resource itself - there is nothing here that can throw a secondary
 * `undefined.close()` TypeError, since an uninitialized resource simply has
 * no thunk in the list.
 */
export async function runCleanupTasks(tasks: ReadonlyArray<() => Promise<void>>): Promise<void> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(`cleanup failed:\n${messages.join('\n')}`);
  }
}
