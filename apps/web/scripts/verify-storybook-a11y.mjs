/**
 * One-off manual a11y verification for Issue #376's Acceptance Criteria
 * ("a11y addon で問題が出ない"). NOT part of CI and not wired into any
 * `package.json` script - PR #377 review found that `build-storybook`
 * succeeding is not evidence of a11y compliance (the addon is configured
 * with `a11y: { test: "todo" }` in .storybook/preview.tsx, which only
 * surfaces violations in the Storybook test UI, it never fails a build).
 * M6 is expected to own any real CI integration (Storybook test-runner /
 * Playwright wired into CI); this script exists only to produce one
 * point-in-time, actually-executed axe-core run against `storybook-static`
 * and print its findings.
 *
 * Usage (from apps/web, after `pnpm run build-storybook`):
 *   node scripts/verify-storybook-a11y.mjs
 *
 * What it does:
 *   1. Serves `storybook-static/` on localhost with a tiny built-in static
 *      file server (no extra dependency for this one-off need).
 *   2. Reads `storybook-static/index.json` (Storybook's story index) and
 *      filters it down to the 4 components named in Issue #376's
 *      Acceptance Criteria: StatePanel, AppShell (which covers AppBar and
 *      PrimaryNav), Badge, Button.
 *   3. Opens each story's `iframe.html?id=<id>&viewMode=story` in a
 *      headless Chromium page (via Playwright, already a devDependency for
 *      e2e), injects axe-core (devDependency added specifically for this
 *      verification), and runs `axe.run()` against the rendered story.
 *   4. Prints a summary (violation count per story) and the full violation
 *      detail for any story that has one, then exits non-zero if any
 *      violations were found.
 */
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "..", "storybook-static");
const AXE_SOURCE_PATH = path.join(
  __dirname,
  "..",
  "node_modules",
  "axe-core",
  "axe.min.js",
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

// Issue #376 Acceptance Criteria names the 4 components directly; AppBar
// and PrimaryNav are covered through the AppShell stories that compose
// them (docs/v2/oracle-routes-ui.md §3), rather than needing separate
// entries here.
const TARGET_TITLE_PREFIXES = [
  "Components/AppShell",
  "Components/StatePanel",
  "UI/Badge",
  "UI/Button",
];

// These 3 rules are all axe's `best-practice` category (none carry a WCAG
// success-criterion tag - see the run output) and assert *whole-document*
// structure: exactly one <main>, all content inside a landmark, exactly one
// <h1> on the page. A Storybook story renders one component in isolation
// inside its own bare iframe document, not a full page - a standalone
// <Badge>/<Button>, or a StatePanel demoed without the real route heading
// that would surround it in production, will always trip these by
// construction. This is a documented, common caveat of running axe against
// isolated component stories (Storybook's own a11y addon issue tracker has
// multiple threads on it), not a defect in these components. Disabling them
// here (this script only) keeps the scan meaningful for what a component-level
// check *can* prove (contrast, name/role/value, aria-*, labels, etc.)
// without demanding every atomic story fake up page furniture it will never
// own in real usage. AppShell's actual <main> landmark (the one thing these
// rules can validate at the component level) is asserted directly in
// src/components/app-shell.test.tsx instead, after PR #377 review found it
// missing.
const DISABLED_RULES = ["landmark-one-main", "region", "page-has-heading-one"];

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const requestedPath = path.join(
        STATIC_DIR,
        urlPath === "/" ? "index.html" : urlPath,
      );
      // Guard against escaping storybook-static via `..` segments.
      if (!requestedPath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const fileStat = await stat(requestedPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentTypeFor(requestedPath) });
      createReadStream(requestedPath).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function main() {
  const indexJson = JSON.parse(
    await readFile(path.join(STATIC_DIR, "index.json"), "utf-8"),
  );
  const axeSource = await readFile(AXE_SOURCE_PATH, "utf-8");

  const targetStories = Object.values(indexJson.entries).filter(
    (entry) =>
      entry.type === "story" &&
      TARGET_TITLE_PREFIXES.some((prefix) => entry.title.startsWith(prefix)),
  );

  if (targetStories.length === 0) {
    throw new Error(
      "No matching stories found - did the story titles change? Check TARGET_TITLE_PREFIXES.",
    );
  }

  const { server, baseUrl } = await startStaticServer();
  const browser = await chromium.launch();

  /** @type {{ id: string; title: string; name: string; violationCount: number; violations: unknown[] }[]} */
  const results = [];

  try {
    const page = await browser.newPage();
    for (const entry of targetStories) {
      const url = `${baseUrl}/iframe.html?id=${entry.id}&viewMode=story`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.addScriptTag({ content: axeSource });
      // Give React a beat to finish mounting before scanning (networkidle
      // covers asset loading, not client-side render completion).
      await page.waitForTimeout(150);
      const axeResults = await page.evaluate(async (disabledRules) => {
        // `axe` is a global injected into the page via addScriptTag above,
        // not an import - this callback runs in the browser context, not
        // under this file's own lint/module scope.
        return axe.run(document, {
          resultTypes: ["violations"],
          rules: Object.fromEntries(
            disabledRules.map((ruleId) => [ruleId, { enabled: false }]),
          ),
        });
      }, DISABLED_RULES);
      results.push({
        id: entry.id,
        title: entry.title,
        name: entry.name,
        violationCount: axeResults.violations.length,
        violations: axeResults.violations,
      });
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== axe-core Storybook verification (Issue #376) ===\n");
  for (const result of results) {
    const label = `${result.title} / ${result.name} (${result.id})`;
    if (result.violationCount === 0) {
      console.log(`OK    ${label}`);
    } else {
      console.log(`FAIL  ${label} - ${result.violationCount} violation(s)`);
    }
  }

  const failing = results.filter((result) => result.violationCount > 0);
  console.log(
    `\n${results.length} stories checked, ${failing.length} with violations, ${
      results.length - failing.length
    } clean.\n`,
  );

  if (failing.length > 0) {
    console.log("=== Violation detail ===\n");
    for (const result of failing) {
      console.log(`--- ${result.title} / ${result.name} (${result.id}) ---`);
      console.log(JSON.stringify(result.violations, null, 2));
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
