import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  cookiesFromHeader,
  launchBrowser,
  type Browser,
  type BrowserPage,
} from './support/browserPage.ts';
import { runCleanupTasks } from './support/cleanupTasks.ts';

// Regression coverage for the test harness itself (test/auth/support/
// browserPage.ts, the playwright-core driver over the system Chrome - Issue
// #277), not a product behavior:
//
// - the `BrowserPage` method contract every other test/auth file relies on
//   (cookie seeding on navigate, attached-not-visible waitForSelector with a
//   bounded timeout, content() vs visibleText()), proven against a real
//   headless Chrome and a tiny local http server rather than against the
//   app - so a driver regression is attributed to the driver, not to a
//   Catalog/Auth test that merely happened to trip over it first;
// - the `newIsolatedContext()` boundary the journey files' two-user actors
//   are separated by (Issue #287): same cookie name, same origin, two
//   contexts, no bleed - and a per-context teardown that disposes exactly
//   that context. Proven here, on the driver, rather than only indirectly
//   through a journey that would report a broken boundary as a product
//   failure;
// - the launch-failure lifecycle (Issue #259: a failed startup must reject
//   promptly with a bounded, informative error and never hang or leak),
//   proven Chrome-free by pointing the driver at a missing binary and at a
//   binary that is not Chrome;
// - runCleanupTasks (test/auth/support/cleanupTasks.ts), the partial-
//   initialization teardown aggregation catalogAccess.test.ts's after()
//   uses, proven against fakes.
//
// Chrome-side termination guarantees (force kill of the whole process
// group on close/failure/exit, bounded graceful close) are playwright-
// core's own - see launchBrowser's doc comment for the exact references -
// and are not re-proven here beyond the fact that this file's own runs
// complete: a leaked Chrome with open stdio pipes would keep `node --test`
// alive, which is exactly the Issue #259 symptom.

// --- cookiesFromHeader: the navigate() cookie seeding contract ---

void test('cookiesFromHeader splits a "name=value; name2=value2" header into per-cookie entries bound to the navigation url', () => {
  assert.deepEqual(cookiesFromHeader('a=1; b=2', 'http://127.0.0.1:1/x'), [
    { name: 'a', value: '1', url: 'http://127.0.0.1:1/x' },
    { name: 'b', value: '2', url: 'http://127.0.0.1:1/x' },
  ]);
});

void test('cookiesFromHeader keeps "=" inside a value (base64 padding in a session cookie) and skips empty segments', () => {
  assert.deepEqual(cookiesFromHeader('sb-token=abc==; ; flag', 'http://127.0.0.1:1/'), [
    { name: 'sb-token', value: 'abc==', url: 'http://127.0.0.1:1/' },
    { name: 'flag', value: '', url: 'http://127.0.0.1:1/' },
  ]);
});

void test('cookiesFromHeader yields no cookies for an undefined or empty header', () => {
  assert.deepEqual(cookiesFromHeader(undefined, 'http://127.0.0.1:1/'), []);
  assert.deepEqual(cookiesFromHeader('', 'http://127.0.0.1:1/'), []);
});

// --- launchBrowser: failure lifecycle, no real Chrome required ---

function missingBinaryPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'no-chrome-here-')), 'not-a-chrome');
}

void test('launchBrowser rejects, without retrying, with the missing path and the Chrome resolution hint when executablePath does not exist', async () => {
  const missing = missingBinaryPath();
  await assert.rejects(launchBrowser({ executablePath: missing }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(missing), 'the searched path must be named');
    assert.match(error.message, /\(executablePath\)/);
    assert.match(error.message, /CHROME_PATH/);
    assert.match(error.message, /\/opt\/google\/chrome\/chrome/);
    assert.doesNotMatch(error.message, /attempt \d\/\d/, 'a resolution failure is not retried');
    return true;
  });
});

void test('launchBrowser treats a CHROME_PATH that points at a missing file as an error naming that path, not as a silent fallback', async () => {
  const missing = missingBinaryPath();
  const previous = process.env.CHROME_PATH;
  process.env.CHROME_PATH = missing;
  try {
    await assert.rejects(launchBrowser(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(missing));
      assert.match(error.message, /\(CHROME_PATH\)/);
      return true;
    });
  } finally {
    if (previous === undefined) {
      delete process.env.CHROME_PATH;
    } else {
      process.env.CHROME_PATH = previous;
    }
  }
});

void test('launchBrowser rejects promptly with a bounded per-attempt summary (final error reachable via cause) when the executable starts but is not Chrome', async () => {
  // node itself, launched with Chrome's flags, exits immediately ("bad
  // option") - a stand-in for a Chrome that crashes at startup. Each
  // attempt is bounded by launchTimeoutMs even if it did not exit.
  const launchTimeoutMs = 5_000;
  const startedAt = Date.now();
  await assert.rejects(
    launchBrowser({ executablePath: process.execPath, launchTimeoutMs }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      // Each attempt's own message is multi-line (playwright-core appends
      // the browser's startup log), so only the summary's shape is pinned.
      assert.match(error.message, /^Chrome startup failed:\nattempt 1\/2: [\s\S]+\nattempt 2\/2: /);
      assert.ok(error.cause instanceof Error, 'the final attempt error must remain reachable');
      return true;
    },
  );
  const elapsedMs = Date.now() - startedAt;
  assert.ok(
    elapsedMs < launchTimeoutMs * 2 + 5_000,
    `both attempts must finish within their bound (took ${String(elapsedMs)}ms)`,
  );
});

// --- BrowserPage contract against a real headless Chrome ---

const PAYLOAD_ONLY_TITLE = 'PAYLOAD_ONLY_TITLE_7f3a';
const HIDDEN_ONLY_TEXT = 'HIDDEN_ONLY_TEXT_7f3a';
const VISIBLE_ONLY_TEXT = 'VISIBLE_ONLY_TEXT_7f3a';

/** A page shaped like the real Catalog render this driver exists for: a
 * hydration-style JSON payload in a `<script>` (present in the DOM, never
 * displayed), a hidden element, visible text, and an element that only
 * gets attached after the load event (like a client-gated render). */
const HARNESS_PAGE_HTML = `<!doctype html>
<html><head><title>harness</title></head><body>
<script type="application/json" id="payload">{"title":"${PAYLOAD_ONLY_TITLE}"}</script>
<p hidden>${HIDDEN_ONLY_TEXT}</p>
<p>${VISIBLE_ONLY_TEXT}</p>
<script>
  setTimeout(() => {
    const late = document.createElement('div');
    late.id = 'late';
    late.hidden = true;
    document.body.append(late);
  }, 100);
</script>
</body></html>`;

let server: Server;
let baseUrl: string;
let browser: Browser;
let page: BrowserPage;
// Same incremental pattern as catalogAccess.test.ts's before()/after()
// (Issue #259): only a resource that actually initialized gets a cleanup.
const initializedCleanups: Array<() => Promise<void>> = [];

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/echo-cookie') {
      const cookie = request.headers.cookie ?? '';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><body><p id="cookie">${cookie}</p></body></html>`);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(HARNESS_PAGE_HTML);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object', 'sanity: listening on a tcp port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  initializedCleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  );
  browser = await launchBrowser();
  initializedCleanups.push(() => browser.close());
  page = await browser.newPage();
  initializedCleanups.push(() => page.close());
});

after(async () => {
  await runCleanupTasks([...initializedCleanups].reverse());
});

void test('raw exposes the Playwright Page for the same tab navigate() drives', async () => {
  await page.navigate(`${baseUrl}/page`);
  assert.equal(page.raw.url(), `${baseUrl}/page`);
  assert.equal(await page.raw.title(), 'harness');
});

void test('navigate() resolves only once the page has finished loading', async () => {
  await page.navigate(`${baseUrl}/page`);
  assert.equal(await page.raw.evaluate(() => document.readyState), 'complete');
});

void test('navigate() seeds cookieHeader as real browser cookies the origin receives on that request', async () => {
  await page.navigate(`${baseUrl}/echo-cookie`, 'harness-a=1; harness-b=abc==');
  const received = await page.visibleText();
  assert.ok(received.includes('harness-a=1'), `expected harness-a in: ${received}`);
  assert.ok(
    received.includes('harness-b=abc=='),
    `expected harness-b (with "=" padding) in: ${received}`,
  );
});

void test('a later navigate() with a new value for the same cookie name replaces the earlier one (the per-viewer sequence catalogAccess relies on)', async () => {
  await page.navigate(`${baseUrl}/echo-cookie`, 'harness-session=first');
  assert.ok((await page.visibleText()).includes('harness-session=first'));
  await page.navigate(`${baseUrl}/echo-cookie`, 'harness-session=second');
  const received = await page.visibleText();
  assert.ok(received.includes('harness-session=second'), `expected second in: ${received}`);
  assert.ok(!received.includes('harness-session=first'), `first must be replaced in: ${received}`);
});

void test('waitForSelector() resolves for an element attached after load even when it is hidden (querySelector semantics, not visibility)', async () => {
  await page.navigate(`${baseUrl}/page`);
  await page.waitForSelector('#late', 3_000);
  assert.equal(await page.raw.evaluate(() => document.getElementById('late')?.hidden), true);
});

void test('waitForSelector() rejects with the bounded "selector not found within" diagnostic instead of hanging', async () => {
  await page.navigate(`${baseUrl}/page`);
  const startedAt = Date.now();
  await assert.rejects(page.waitForSelector('#never-attached', 200), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'selector not found within 200ms: #never-attached');
    return true;
  });
  assert.ok(Date.now() - startedAt < 5_000, 'must give up at the caller-supplied bound');
});

void test('content() includes hydration-payload and hidden text that visibleText() excludes', async () => {
  await page.navigate(`${baseUrl}/page`);
  const [html, visibleText] = await Promise.all([page.content(), page.visibleText()]);
  for (const text of [PAYLOAD_ONLY_TITLE, HIDDEN_ONLY_TEXT, VISIBLE_ONLY_TEXT]) {
    assert.ok(html.includes(text), `content() must include ${text}`);
  }
  assert.ok(visibleText.includes(VISIBLE_ONLY_TEXT));
  assert.ok(!visibleText.includes(PAYLOAD_ONLY_TITLE), 'script payload is not visible text');
  assert.ok(!visibleText.includes(HIDDEN_ONLY_TEXT), 'a hidden element is not visible text');
});

// --- newIsolatedContext: the per-actor session boundary (Issue #287) ---

void test('two isolated contexts of one Chrome hold the same cookie name at the same origin independently', async () => {
  // The exact shape the journey actors are in: one Supabase session cookie
  // name, one origin, two signed-in users. A shared jar would let the
  // second seeding overwrite the first, and every later navigation would
  // silently be the wrong user.
  const first = await browser.newIsolatedContext();
  const second = await browser.newIsolatedContext();
  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();

    await firstPage.navigate(`${baseUrl}/echo-cookie`, 'sb-session=first-user');
    await secondPage.navigate(`${baseUrl}/echo-cookie`, 'sb-session=second-user');
    // Re-read the first context *after* the second seeded that same name:
    // this is what a journey's next `goto()` does, and what would quietly
    // carry the other user's session if the jars were shared.
    await firstPage.navigate(`${baseUrl}/echo-cookie`);

    const firstReceived = await firstPage.visibleText();
    const secondReceived = await secondPage.visibleText();
    assert.ok(
      firstReceived.includes('sb-session=first-user'),
      `the first context must keep its own session: ${firstReceived}`,
    );
    assert.ok(
      !firstReceived.includes('second-user'),
      `the second context's session must never reach the first: ${firstReceived}`,
    );
    assert.ok(
      secondReceived.includes('sb-session=second-user'),
      `the second context must keep its own session: ${secondReceived}`,
    );
    assert.ok(
      !secondReceived.includes('first-user'),
      `the first context's session must never reach the second: ${secondReceived}`,
    );
  } finally {
    await first.close();
    await second.close();
  }
});

void test('an isolated context shares neither cookies nor localStorage with the browser-wide newPage() context', async () => {
  const isolated = await browser.newIsolatedContext();
  try {
    const isolatedPage = await isolated.newPage();
    await page.navigate(`${baseUrl}/echo-cookie`, 'sb-shared=shared-context');
    await page.raw.evaluate(() => {
      localStorage.setItem('sb-storage', 'shared-context');
    });

    await isolatedPage.navigate(`${baseUrl}/echo-cookie`);
    const received = await isolatedPage.visibleText();
    assert.ok(
      !received.includes('sb-shared'),
      `the shared context's cookie must not reach an isolated one: ${received}`,
    );
    assert.equal(
      await isolatedPage.raw.evaluate(() => localStorage.getItem('sb-storage')),
      null,
      'storage is per-context too, not only cookies',
    );
  } finally {
    await isolated.close();
  }
});

void test('closing one isolated context discards that context alone - its pages close and its cookies go, while the other context and the Chrome process stay usable', async () => {
  const closed = await browser.newIsolatedContext();
  const survivor = await browser.newIsolatedContext();
  try {
    const closedPage = await closed.newPage();
    const survivorPage = await survivor.newPage();
    await closedPage.navigate(`${baseUrl}/echo-cookie`, 'sb-session=closing-user');
    await survivorPage.navigate(`${baseUrl}/echo-cookie`, 'sb-session=surviving-user');

    await closed.close();
    assert.equal(closedPage.raw.isClosed(), true, 'the context close must take its pages with it');
    await assert.doesNotReject(closed.close(), 'a second close of the same context must be safe');

    // The other actor keeps working, on the same Chrome, with its own jar.
    await survivorPage.navigate(`${baseUrl}/echo-cookie`);
    const survivorReceived = await survivorPage.visibleText();
    assert.ok(
      survivorReceived.includes('sb-session=surviving-user'),
      `the surviving context must be unaffected: ${survivorReceived}`,
    );
    // A fresh context proves the closed one's cookies are really gone,
    // rather than merely unreachable through a closed page.
    const replacement = await browser.newIsolatedContext();
    try {
      const replacementPage = await replacement.newPage();
      await replacementPage.navigate(`${baseUrl}/echo-cookie`);
      const replacementReceived = await replacementPage.visibleText();
      assert.ok(
        !replacementReceived.includes('closing-user'),
        `a closed context's session must not survive it: ${replacementReceived}`,
      );
    } finally {
      await replacement.close();
    }
  } finally {
    await survivor.close();
  }
});

void test('page.close() then browser.close() is safe, browser.close() disposes an isolated context too, and closing either again does not throw', async () => {
  const extraBrowser = await launchBrowser();
  const extraPage = await extraBrowser.newPage();
  await extraPage.navigate(`${baseUrl}/page`);
  await extraPage.close();
  assert.equal(extraPage.raw.isClosed(), true);
  // The file-level safety net a journey file keeps behind its per-actor
  // closes: a context whose own close() never ran (a before() that threw
  // partway, a journey that failed mid-test) still goes away with the
  // process, and a teardown that closes it afterwards must not turn that
  // into a second failure.
  const leftOpen = await extraBrowser.newIsolatedContext();
  const leftOpenPage = await leftOpen.newPage();
  await leftOpenPage.navigate(`${baseUrl}/page`);
  await extraBrowser.close();
  assert.equal(
    leftOpenPage.raw.isClosed(),
    true,
    'closing the browser must take its isolated contexts with it',
  );
  await assert.doesNotReject(leftOpen.close(), 'closing a context after its browser must be safe');
  await assert.doesNotReject(extraBrowser.close());
});

// --- runCleanupTasks: partial initialization / aggregation ---

void test('runCleanupTasks resolves when every task succeeds', async () => {
  const ran: string[] = [];
  await runCleanupTasks([
    () => {
      ran.push('a');
      return Promise.resolve();
    },
    () => {
      ran.push('b');
      return Promise.resolve();
    },
  ]);
  assert.deepEqual(ran, ['a', 'b']);
});

void test('runCleanupTasks only contains cleanups for resources actually initialized - simulating app-only, app+browser, and app+browser+page partial init', async () => {
  for (const initializedCount of [1, 2, 3]) {
    const ran: string[] = [];
    const allResourceCleanups = [
      () => {
        ran.push('app');
        return Promise.resolve();
      },
      () => {
        ran.push('browser');
        return Promise.resolve();
      },
      () => {
        ran.push('page');
        return Promise.resolve();
      },
    ];
    // Mirrors catalogAccess.test.ts's before(): each cleanup is pushed only
    // once its resource actually finished initializing, so a before() that
    // fails partway through never reaches the later pushes.
    const initialized = allResourceCleanups.slice(0, initializedCount);

    await runCleanupTasks(initialized);

    assert.equal(
      ran.length,
      initializedCount,
      `only the ${String(initializedCount)} initialized resource(s) should have been cleaned up`,
    );
  }
});

void test('runCleanupTasks attempts every task even when an earlier one fails, and aggregates every failure', async () => {
  const attempted: string[] = [];
  await assert.rejects(
    runCleanupTasks([
      () => {
        attempted.push('page');
        return Promise.reject(new Error('page close failed'));
      },
      () => {
        attempted.push('browser');
        return Promise.resolve();
      },
      () => {
        attempted.push('app');
        return Promise.reject(new Error('app stop failed'));
      },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /page close failed/);
      assert.match(error.message, /app stop failed/);
      return true;
    },
  );

  assert.deepEqual(
    attempted,
    ['page', 'browser', 'app'],
    'every cleanup task must still be attempted, even after an earlier one throws - no undefined.close() short-circuit and no skipped resource',
  );
});

void test('runCleanupTasks never throws a secondary undefined.close()-shaped TypeError for a resource that was never pushed', async () => {
  // The direct regression proof: an uninitialized resource has no entry in
  // the task list at all (unlike the original `await browser.close()` on a
  // `browser` that was never assigned), so there is nothing here that can
  // produce `Cannot read properties of undefined (reading 'close')`.
  await runCleanupTasks([
    () => {
      // only "app" initialized
      return Promise.resolve();
    },
  ]);
});
