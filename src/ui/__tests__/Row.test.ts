import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The row primitive's own contract (Issue #271/#311).
 *
 * This file used to also carry migratedRows / migratedMains /
 * migratedAsides - three hand-kept lists of every consumer that composes
 * these roles, each entry asserting both that the consumer composes and
 * that it does not restate what it composed - plus the same shape of list
 * for the selected-day list (Issue #315). Issue #312 replaced the
 * "does not restate" half with sharedCssRules.ts, which checks every
 * *.module.css under src/app and src/ui without a registry, so a new
 * consumer needs no entry anywhere; the selected-day wiring moved to
 * selectedDayList.test.ts, next to the module it belongs to.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const css = readFileSync(`${root}/src/ui/row.module.css`, 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} rule is missing from src/ui/row.module.css`);
  return match[1] ?? '';
}

void test('Issue #271: the shared row primitive owns the flex shrink contract', () => {
  assert.match(cssRule('.row'), /display:\s*flex;/);
  assert.match(cssRule('.row'), /align-items:\s*center;/);
  assert.match(cssRule('.row'), /justify-content:\s*space-between;/);
  assert.match(cssRule('.row'), /gap:\s*var\(--space-sm\);/);
  assert.match(cssRule('.main'), /flex:\s*1 1 auto;/);
  assert.match(cssRule('.main'), /min-width:\s*0;/);
  assert.match(cssRule('.aside'), /flex:\s*0 0 auto;/);
});

void test('Issue #311: the inline badge sizing belongs to the row boundary, in one place', () => {
  // A standalone Badge needs no flex-child sizing contract, so this lives
  // with the row layout rather than in Badge.module.css - and it is stated
  // exactly once.
  assert.match(cssRule('.inlineBadge'), /flex-shrink:\s*0;/);
  assert.equal((css.match(/flex-shrink:\s*0\s*;/g) ?? []).length, 1);
});
