import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classesDefinedIn,
  classesMentionedIn,
  composesRole,
  readCss,
  splitSelectorList,
  stripCssComments,
} from './sharedRoleWiring.ts';

/*
 * The shared month-calendar grid (Issue #314), asserted here once rather
 * than in each screen that composes it: MonthCalendar.test.ts and
 * MyMonthCalendar.test.ts used to carry the same `.day:hover` guard and the
 * same 19-name composition list, and CalendarSkeleton.test.ts a third
 * fragment of it (Issue #312).
 */

const AUTHORITY = 'monthCalendarGrid.module.css';
const shared = readCss('src/ui/monthCalendarGrid.module.css');

/**
 * Selector branches that style a hovered or pressed `.day` without
 * excluding `.daySelected`, plus the branches that do exclude it.
 *
 * `.day:hover` (a class + a pseudo-class) is more specific than the
 * single-class `.daySelected`, so an unscoped hover rule wins the cascade
 * over the selected cell's own presentation whenever both match - which
 * touch browsers make sticky after a tap, until a different cell is tapped
 * (Issue #77).
 *
 * Read branch by branch rather than with one anchored pattern: a valid rule
 * elsewhere in the file must not be able to satisfy the guard while a
 * reordered one slips past, and `:active` carries the same cascade conflict
 * as `:hover`.
 */
const dayHoverBranches = (css: string): { unguarded: string[]; guarded: string[] } => {
  const unguarded: string[] = [];
  const guarded: string[] = [];

  for (const rule of stripCssComments(css).matchAll(/([^{}]+)\{/g)) {
    for (const branch of splitSelectorList(rule[1] ?? '')) {
      if (branch.startsWith('@') || !/:hover|:active/.test(branch)) {
        continue;
      }
      const classes = [...branch.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
      if (!classes.includes('day')) {
        // `.daySelected:hover` is the selected cell's own rule, not a
        // generic one competing with it.
        continue;
      }
      (/:not\(\s*\.daySelected\s*\)/.test(branch) ? guarded : unguarded).push(branch);
    }
  }

  return { unguarded, guarded };
};

void test('Issue #77: every hovered/pressed .day branch excludes .daySelected', () => {
  const { unguarded, guarded } = dayHoverBranches(shared);

  assert.deepEqual(
    unguarded,
    [],
    'these style a hovered/pressed day without excluding .daySelected',
  );
  // The guard is only meaningful while the rules it guards exist.
  assert.ok(
    guarded.length >= 2,
    `expected hover and press rules, found ${JSON.stringify(guarded)}`,
  );
});

void test('the guard reads selector lists rather than splitting inside :is()/:not()', () => {
  // A comma inside a selector function must not break a branch in two:
  // neither half would carry both `.day` and `:hover`, so an unguarded
  // selector would be skipped entirely (PR #342 review).
  for (const selector of [
    '.day:hover',
    '.day:active',
    '.day:not(.other):hover',
    '.day:is(.past, .future):hover',
    '.other:hover,\n.day:hover',
  ]) {
    assert.equal(
      dayHoverBranches(`${selector} {\n  background-color: red;\n}\n`).unguarded.length,
      1,
      selector,
    );
  }

  for (const selector of [
    '.day:hover:not(.daySelected)',
    '.day:is(.past, .future):hover:not(.daySelected)',
    '.daySelected:hover',
    '.daySelected:active',
  ]) {
    assert.deepEqual(
      dayHoverBranches(`${selector} {\n  background-color: red;\n}\n`).unguarded,
      [],
      selector,
    );
  }
});

/*
 * Required composition wiring.
 *
 * These two screens render the same grid, and their class names mirror the
 * shared module's, so the wiring is expressed as "every class you define
 * under a shared name must compose it" rather than by listing all 19 roles
 * twice. Deleting a `composes:` line - with or without local declarations
 * left behind - fails here.
 */
const gridConsumers = [
  'src/app/catalog/_components/MonthCalendar.module.css',
  'src/app/calendar/_components/MyMonthCalendar.module.css',
] as const;

void test('Issue #314: both month calendars compose every grid role they define', () => {
  const roles = classesMentionedIn(shared);

  for (const relativePath of gridConsumers) {
    const css = readCss(relativePath);
    const shadowed = classesDefinedIn(css).filter((name) => roles.has(name));

    assert.ok(shadowed.length > 0, `${relativePath} no longer shares the month-calendar grid`);
    for (const name of shadowed) {
      assert.ok(
        composesRole(css, name, name, AUTHORITY),
        `${relativePath} .${name} must compose ${name} from ${AUTHORITY} rather than restate it`,
      );
    }
  }
});

void test('Issue #314: CalendarSkeleton shares the weekday header, and only that', () => {
  // The skeleton's header/week/day placeholders are deliberately its own
  // (see the comment at the top of CalendarSkeleton.module.css): a pulsing
  // block is not a date cell. The weekday header was the one byte-identical
  // third copy, so it is the one piece composed from the shared module.
  const css = readCss('src/ui/CalendarSkeleton.module.css');
  for (const role of ['weekdayRow', 'weekday']) {
    assert.ok(
      composesRole(css, role, role, AUTHORITY),
      `CalendarSkeleton .${role} must compose ${role} from ${AUTHORITY}`,
    );
  }
});
