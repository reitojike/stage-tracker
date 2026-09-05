import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The shared visually-hidden contracts (Issue #317).
 *
 * The six-consumer census this file used to carry (exactly 6 compositions,
 * 4 of one contract and 2 of the other) had to be edited whenever a consumer
 * was added, and its "no `clip: rect(0, 0, 0, 0)` anywhere" half is now
 * repository-wide: sharedCssRules.ts (Issue #312) fails any module that
 * clips an element to zero area outside this authority, including a
 * brand-new one.
 */

const sharedCss = readFileSync(
  fileURLToPath(new URL('../visuallyHidden.module.css', import.meta.url)),
  'utf8',
);

void test('keeps the full visually-hidden contract centralized and focusable', () => {
  const fullRule = sharedCss.match(/\.visuallyHidden\s*\{([^}]*)\}/);
  assert.ok(fullRule, 'full visually-hidden rule is missing');
  assert.match(fullRule[1] ?? '', /position:\s*absolute;/);
  assert.match(fullRule[1] ?? '', /width:\s*1px;/);
  assert.match(fullRule[1] ?? '', /height:\s*1px;/);
  assert.match(fullRule[1] ?? '', /overflow:\s*hidden;/);
  assert.match(fullRule[1] ?? '', /clip-path:\s*inset\(50%\);/);
  assert.match(fullRule[1] ?? '', /white-space:\s*nowrap;/);
  assert.match(fullRule[1] ?? '', /border:\s*0;/);
  assert.doesNotMatch(fullRule[1] ?? '', /display:\s*none/);
});

void test('keeps a separate minimal contract for empty live-region shells', () => {
  const minimalRule = sharedCss.match(/\.visuallyHiddenRegion\s*\{([^}]*)\}/);
  assert.ok(minimalRule, 'minimal visually-hidden rule is missing');
  assert.match(minimalRule[1] ?? '', /position:\s*absolute;/);
  assert.match(minimalRule[1] ?? '', /clip-path:\s*inset\(50%\);/);
  assert.doesNotMatch(minimalRule[1] ?? '', /white-space|border:|padding:|margin:/);
});
