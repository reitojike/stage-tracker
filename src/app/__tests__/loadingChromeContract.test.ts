import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  importsAndRendersComponent,
  LOADING_CHROME_ALLOWLIST,
  readSource,
  sourceExists,
} from './loadingChromeContract.ts';

/*
 * Issue #355. Two layers, mirroring src/ui/__tests__/sharedRoleWiring.test.ts:
 *
 * 1. Meta tests proving `importsAndRendersComponent` actually fails on the
 *    ways a route could lose its stable chrome (Acceptance Criteria: "guard
 *    が current violation を検出できる") - without these, the per-route
 *    tests below would only prove the allowlist agrees with itself.
 * 2. One test per allowlisted route, checking current
 *    `src/app/**\/loading.tsx` content against Issue #355's fresh
 *    classification. This is the "route -> expected chrome" guard the
 *    Acceptance Criteria asks for, and deliberately checks only the chrome
 *    each route actually lists - it does not require `PageHeading` (or any
 *    other chrome) for a route the allowlist excludes it from, per the
 *    Test contract's "allowlist外のdata-dependent chromeを機械的に要求
 *    しない".
 */

void test('importsAndRendersComponent requires both the import and a JSX usage', () => {
  const importOnly =
    "import { PageHeading } from '@/ui/PageHeading';\nexport default function X() { return null; }\n";
  const usageOnly = 'export default function X() { return <PageHeading>x</PageHeading>; }\n';
  const both =
    "import { PageHeading } from '@/ui/PageHeading';\nexport default function X() { return <PageHeading>x</PageHeading>; }\n";

  assert.equal(importsAndRendersComponent(importOnly, 'PageHeading'), false);
  assert.equal(importsAndRendersComponent(usageOnly, 'PageHeading'), false);
  assert.equal(importsAndRendersComponent(both, 'PageHeading'), true);
});

void test('importsAndRendersComponent does not match a different component name', () => {
  const source =
    "import { BackLink } from '@/ui/BackLink';\n" +
    'export default function X() { return <BackLink href="/">back</BackLink>; }\n';

  assert.equal(importsAndRendersComponent(source, 'PageHeading'), false);
  assert.equal(importsAndRendersComponent(source, 'BackLink'), true);
});

void test('importsAndRendersComponent ignores a bare mention with no import', () => {
  // A loading.tsx that only *talks about* PageHeading (e.g. in a comment)
  // without importing/rendering it must not pass - that is exactly the
  // "component present in text but not actually materialized" case this
  // guard exists to catch.
  const source =
    '// PageHeading lives on the real page, not here.\nexport default function X() { return null; }\n';

  assert.equal(importsAndRendersComponent(source, 'PageHeading'), false);
});

void test('importsAndRendersComponent ignores JSX-shaped text left behind in a comment after the real usage is removed', () => {
  // PR #363 review (CodeRabbit): a retained import plus a stray
  // `<PageHeading />`-shaped comment must not read as "still rendered" -
  // that is exactly the false negative this guard exists to prevent.
  const source =
    "import { PageHeading } from '@/ui/PageHeading';\n" +
    '// <PageHeading>ホーム</PageHeading> used to live here.\n' +
    'export default function X() { return null; }\n';

  assert.equal(importsAndRendersComponent(source, 'PageHeading'), false);
});

void test('importsAndRendersComponent ignores JSX-shaped text inside a string literal', () => {
  const source =
    "import { PageHeading } from '@/ui/PageHeading';\n" +
    "const example = '<PageHeading>ホーム</PageHeading>';\n" +
    'export default function X() { return null; }\n';

  assert.equal(importsAndRendersComponent(source, 'PageHeading'), false);
});

void test('importsAndRendersComponent does not let a "//"-bearing string swallow a real usage on the same line', () => {
  // PR #363 review, round 2 (codex): stripping comments and strings in
  // separate passes is order-dependent - a plain string containing `//`
  // (e.g. a URL) ahead of the real usage would have the line-comment pass
  // treat everything after that `//`, including the real tag later on the
  // same line, as commented out. This is the false *negative* the combined
  // single-pass pattern exists to prevent.
  const source =
    "import { PageHeading } from '@/ui/PageHeading';\n" +
    'export default function X() { const url = "https://example.com"; return <PageHeading>ホーム</PageHeading>; }\n';

  assert.equal(importsAndRendersComponent(source, 'PageHeading'), true);
});

for (const expectation of LOADING_CHROME_ALLOWLIST) {
  void test(`${expectation.route}: loading.tsx exists and materializes its allowlisted chrome`, () => {
    assert.equal(
      sourceExists(expectation.loadingPath),
      true,
      `expected ${expectation.loadingPath} to exist`,
    );

    const source = readSource(expectation.loadingPath);
    for (const chrome of expectation.expectedChrome) {
      assert.equal(
        importsAndRendersComponent(source, chrome),
        true,
        `expected ${expectation.loadingPath} to import and render <${chrome}>`,
      );
    }
  });
}
