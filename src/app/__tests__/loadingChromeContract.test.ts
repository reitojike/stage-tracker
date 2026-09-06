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
