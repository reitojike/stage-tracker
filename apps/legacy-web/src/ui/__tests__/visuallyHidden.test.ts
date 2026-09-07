import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composesRole, readCss } from './sharedRoleWiring.ts';

/*
 * The shared visually-hidden contracts (Issue #317).
 *
 * This file used to carry a census - exactly 6 compositions, 4 of one
 * contract and 2 of the other - which had to be edited whenever a consumer
 * was added, and which said nothing about *which* consumer had lost its
 * composition. Issue #312 replaced it with the wiring below: named
 * consumers, no counts.
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

/*
 * Required composition wiring. A control that loses this composition does
 * not look broken - its label simply becomes visible, or its input becomes
 * unreachable - so it is worth naming the consumers. Adding a seventh means
 * adding a row; there is no count to keep in step.
 */
const wiring = [
  ['src/ui/TriStateCheckbox.module.css', 'input', 'visuallyHidden'],
  ['src/app/catalog/_components/FilterSheet.module.css', 'chipInput', 'visuallyHidden'],
  ['src/app/schedule/_components/ScheduleWriteForm.module.css', 'controlInput', 'visuallyHidden'],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', 'srOnly', 'visuallyHidden'],
  ['src/ui/WriteNotice.module.css', 'noticeRegionEmpty', 'visuallyHiddenRegion'],
  [
    'src/app/catalog/_components/EventWriteForm.module.css',
    'sheetLifecycleFeedbackEmpty',
    'visuallyHiddenRegion',
  ],
] as const;

void test('every visually-hidden consumer composes one of the two shared contracts', () => {
  for (const [relativePath, className, role] of wiring) {
    assert.ok(
      composesRole(readCss(relativePath), className, role, 'visuallyHidden.module.css'),
      `${relativePath} .${className} must compose ${role} from visuallyHidden.module.css`,
    );
  }
});
