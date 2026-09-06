import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classesDefinedIn, classesMentionedIn, composesRole, readCss } from './sharedRoleWiring.ts';

/*
 * The shared selected-day list presentation (Issue #315). Its consumer
 * wiring used to sit in Row.test.ts beside the row primitive's own; Issue
 * #312 moved it next to the module it belongs to.
 */

const AUTHORITY = 'selectedDayList.module.css';
const shared = readCss('src/ui/selectedDayList.module.css');

void test('the shared list builds its row on the row primitive rather than its own flex sizing', () => {
  // itemLink/itemBody/chevron are a row/main/aside triple: the shared list
  // is itself a consumer of src/ui/row.module.css, so the sizing contract
  // still has exactly one authority.
  for (const [className, role] of [
    ['itemLink', 'row'],
    ['itemBody', 'main'],
    ['chevron', 'aside'],
  ] as const) {
    assert.ok(
      composesRole(shared, className, role, 'row.module.css'),
      `.${className} must compose ${role} from row.module.css`,
    );
  }
});

/*
 * Required composition wiring. As with the month calendar, these three
 * implementations mirror the shared module's class names, so the wiring is
 * "every class you define under a shared name must compose it" rather than
 * three copies of a nine-role list - EventLevelFallbackList has no `.time`,
 * for one, and that stays a property of the file rather than of a list.
 */
const listConsumers = [
  'src/app/calendar/_components/MySelectedDayList.module.css',
  'src/app/catalog/_components/SelectedDayList.module.css',
  'src/app/catalog/_components/EventLevelFallbackList.module.css',
] as const;

void test('Issue #315: every selected-day implementation composes the roles it defines', () => {
  const roles = classesMentionedIn(shared);

  for (const relativePath of listConsumers) {
    const css = readCss(relativePath);
    const shadowed = classesDefinedIn(css).filter((name) => roles.has(name));

    assert.ok(shadowed.length > 0, `${relativePath} no longer shares the selected-day list`);
    for (const name of shadowed) {
      assert.ok(
        composesRole(css, name, name, AUTHORITY),
        `${relativePath} .${name} must compose ${name} from ${AUTHORITY} rather than restate it`,
      );
    }
  }
});
