import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { authorityExports, composesRole, definedClasses } from './sharedCssRules.ts';

/*
 * The shared month-calendar grid (Issue #314) is asserted here once, rather
 * than in each screen that composes it: MonthCalendar.test.ts and
 * MyMonthCalendar.test.ts used to carry the same .day:hover guard and the
 * same 19-name composition list, and CalendarSkeleton.test.ts a third
 * fragment of it (Issue #312).
 *
 * Restating one of these rules beside the composition is caught repository-
 * wide by sharedCssRules.ts, so what is left here is the module's own rule
 * and the wiring: the screens that share this presentation are still wired
 * to it.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relativePath: string) => ({
  path: relativePath,
  css: readFileSync(`${root}/${relativePath}`, 'utf8'),
});

const AUTHORITY = 'src/ui/monthCalendarGrid.module.css';
const shared = read(AUTHORITY);

void test('Issue #77: .day:hover is scoped with :not(.daySelected) so the selected ring always wins', () => {
  // `.day:hover` (a class + a pseudo-class) is more specific than the
  // single-class `.daySelected`, so an unscoped hover rule wins the cascade
  // over the selected cell's own presentation whenever both match - which
  // touch browsers make sticky after a tap, until a different cell is
  // tapped. Comments are stripped first: this module's own prose quotes
  // `.day:hover`.
  const css = shared.css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(
    css,
    /\.day(?::hover:not\(\.daySelected\)|:not\(\.daySelected\):hover)\s*\{/,
    '.day:hover must be scoped with :not(.daySelected) (either token order)',
  );
  // Catches the bug re-appearing via a selector LIST too (e.g.
  // `.day:hover,\n.day:focus-visible {`), not just a bare `.day:hover {`.
  const unscopedHover = /\.day:hover(?!:not\(\.daySelected\))\b/.exec(css);
  assert.equal(unscopedHover, null, `found an unscoped selector: ${String(unscopedHover?.[0])}`);
});

/*
 * The two month calendars and the loading skeleton. Not a registry of every
 * shared class: each file is checked against whatever it happens to define,
 * so a class added to (or removed from) the shared module needs no update
 * here, and neither does a new consumer.
 */
const wiredConsumers = [
  'src/app/catalog/_components/MonthCalendar.module.css',
  'src/app/calendar/_components/MyMonthCalendar.module.css',
] as const;

void test('Issue #314: both month calendars compose every grid class they define', () => {
  const exported = authorityExports(shared.css);

  for (const relativePath of wiredConsumers) {
    const consumer = read(relativePath);
    const shadowed = definedClasses(consumer.css).filter((name) => exported.has(name));

    assert.ok(shadowed.length > 0, `${relativePath} no longer shares the month-calendar grid`);
    for (const name of shadowed) {
      assert.ok(
        composesRole(consumer, name, AUTHORITY),
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
  const skeleton = read('src/ui/CalendarSkeleton.module.css');
  for (const name of ['weekdayRow', 'weekday']) {
    assert.ok(
      composesRole(skeleton, name, AUTHORITY),
      `CalendarSkeleton .${name} must compose ${name} from ${AUTHORITY}`,
    );
  }
});
