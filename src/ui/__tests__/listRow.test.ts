import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classesDefinedIn,
  classesMentionedIn,
  composesRole,
  readCss,
  ruleBody,
} from './sharedRoleWiring.ts';

/*
 * The shared list-row presentation (Issue #315, renamed from
 * selectedDayList.module.css by Issue #359 once Tickets' title role and
 * Home/My Page's cross-feature consumers made "selected-day" too narrow a
 * name for its actual consumer scope). Its consumer wiring used to sit in
 * Row.test.ts beside the row primitive's own; Issue #312 moved it next to
 * the module it belongs to.
 */

const AUTHORITY = 'listRow.module.css';
const shared = readCss('src/ui/listRow.module.css');

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

void test('Issue #359: the item separator is scoped to `.item`, not a generic sibling reset, so a trailing non-item row never inherits it', () => {
  const body = ruleBody(shared, '.item:not(:last-child)');
  assert.ok(body, '.item:not(:last-child) rule is missing');
  assert.match(body, /border-bottom:\s*1px solid var\(--color-border\);/);
});

void test('Issue #359: badgeRow is the shared badges layout plus the top-margin every current consumer adds', () => {
  const body = ruleBody(shared, '.badgeRow');
  assert.ok(body, '.badgeRow rule is missing');
  assert.match(body, /composes:\s*badges;/);
  assert.match(body, /margin-top:\s*var\(--space-2xs\);/);
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

    assert.ok(shadowed.length > 0, `${relativePath} no longer shares the list-row presentation`);
    for (const name of shadowed) {
      assert.ok(
        composesRole(css, name, name, AUTHORITY),
        `${relativePath} .${name} must compose ${name} from ${AUTHORITY} rather than restate it`,
      );
    }
  }
});

/*
 * Issue #359: cross-feature consumers that reuse only some roles, rather
 * than reimplementing the whole list. Each only defines a subset of the
 * shared vocabulary (and HomeUpcomingList's own `.list`/`.items` are
 * deliberately NOT shared - different gap, a byte-identical `.items` reset
 * that predates this authority - so this is an explicit per-file role map,
 * not the whole-file scan above, which would wrongly demand those two
 * compose too).
 */
const partialConsumers = [
  [
    'src/app/(home)/_components/HomeUpcomingList.module.css',
    [
      ['item', 'item'],
      ['itemLink', 'itemLink'],
      ['itemBody', 'itemBody'],
      ['chevron', 'chevron'],
      ['time', 'time'],
      ['title', 'title'],
      ['venue', 'venue'],
      ['badgeRow', 'badgeRow'],
    ],
  ],
  [
    'src/app/(home)/_components/HomeDeadlineList.module.css',
    [
      ['chevron', 'chevron'],
      ['eventTitle', 'title'],
    ],
  ],
  [
    'src/app/mypage/_components/ScheduleAndEventSection.module.css',
    [
      ['item', 'item'],
      ['itemLink', 'itemLink'],
      ['chevron', 'chevron'],
    ],
  ],
  ['src/app/tickets/_components/TicketOpportunityRow.module.css', [['eventTitle', 'title']]],
] as const;

void test('Issue #359: Home / My Page / Tickets compose the list-row roles they reuse directly from ui/listRow.module.css, not through a screen-local module', () => {
  for (const [relativePath, roleMap] of partialConsumers) {
    const css = readCss(relativePath);
    for (const [className, role] of roleMap) {
      assert.ok(
        composesRole(css, className, role, AUTHORITY),
        `${relativePath} .${className} must compose ${role} from ${AUTHORITY}`,
      );
    }
  }
});
