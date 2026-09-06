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
 * for the selected-day list (Issue #315).
 *
 * Issue #312 removed all four. The selected-day wiring moved to
 * selectedDayList.test.ts, next to the module it belongs to. The row roles
 * deliberately kept no consumer wiring of their own: unlike the fixed
 * submit bar or the visually-hidden contract, these are small generic flex
 * declarations whose loss degrades a layout rather than breaking a control,
 * and the list ran to 58 entries across 15 files. Tracking every one of
 * them permanently was not justified by any observed regression, so it is
 * an accepted residual risk covered by review. If a row composition is ever
 * actually lost in a way that reaches users, that evidence - not the
 * possibility - is what should bring a bounded wiring list back here.
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
