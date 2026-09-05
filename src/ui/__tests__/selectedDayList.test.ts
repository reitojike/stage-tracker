import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { authorityExports, composesRole, definedClasses } from './sharedCssRules.ts';

/*
 * The shared selected-day list presentation (Issue #315). Its consumer
 * wiring used to sit in Row.test.ts beside the row primitive's own; Issue
 * #312 moved it next to the module it belongs to, and left the "must not
 * restate what it composes" half to sharedCssRules.ts, which checks every
 * module.css rather than these three by name.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relativePath: string) => ({
  path: relativePath,
  css: readFileSync(`${root}/${relativePath}`, 'utf8'),
});

const AUTHORITY = 'src/ui/selectedDayList.module.css';
const shared = read(AUTHORITY);

void test('the shared list builds its row on the row primitive rather than its own flex sizing', () => {
  // itemLink/itemBody/chevron are a row/main/aside triple: the shared list
  // is itself a consumer of src/ui/row.module.css, so the sizing contract
  // still has exactly one authority.
  for (const [name, role] of [
    ['itemLink', 'row'],
    ['itemBody', 'main'],
    ['chevron', 'aside'],
  ] as const) {
    assert.match(
      shared.css,
      new RegExp(
        `\\.${name}\\s*\\{\\s*composes:\\s*${role}\\s+from\\s+['"][^'"]*row\\.module\\.css['"];`,
      ),
      `.${name} must compose ${role} from row.module.css`,
    );
  }
});

/*
 * Not a registry of every shared class: each file is checked against
 * whatever it happens to define (EventLevelFallbackList has no `.time`, for
 * one), so adding a class to the shared module - or a new consumer - needs
 * no update here.
 */
const wiredConsumers = [
  'src/app/calendar/_components/MySelectedDayList.module.css',
  'src/app/catalog/_components/SelectedDayList.module.css',
  'src/app/catalog/_components/EventLevelFallbackList.module.css',
] as const;

void test('Issue #315: every selected-day implementation composes the shared presentation it defines', () => {
  const exported = authorityExports(shared.css);

  for (const relativePath of wiredConsumers) {
    const consumer = read(relativePath);
    const shadowed = definedClasses(consumer.css).filter((name) => exported.has(name));

    assert.ok(shadowed.length > 0, `${relativePath} no longer shares the selected-day list`);
    for (const name of shadowed) {
      assert.ok(
        composesRole(consumer, name, AUTHORITY),
        `${relativePath} .${name} must compose ${name} from ${AUTHORITY} rather than restate it`,
      );
    }
  }
});
