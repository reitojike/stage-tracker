import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Issue #314 moved the week-grid/date-cell/weekday-header/month-nav/
// holiday-notice rules (including .day:hover's own :not(.daySelected)
// scoping, see Issue #77) into src/ui/monthCalendarGrid.module.css, shared
// with the Event Catalog's MonthCalendar.module.css - this file now only
// composes those classes, so the regression guard below reads the shared
// module instead of this file.
const localCssPath = fileURLToPath(new URL('../MyMonthCalendar.module.css', import.meta.url));
const sharedCssPath = fileURLToPath(
  new URL('../../../../ui/monthCalendarGrid.module.css', import.meta.url),
);

void test('.day:hover is scoped with :not(.daySelected) so selected fill always wins', () => {
  // Comments (including this file's own explanation, which quotes
  // `.day:hover` in prose) are stripped first so they can't be mistaken for
  // actual selector rules by the checks below.
  const css = readFileSync(sharedCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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

// Issue #314: the week-grid/date-cell/weekday-header/month-nav/
// holiday-notice classes are composed from the shared module, not
// restated locally - guards against the duplication this Issue removed
// silently creeping back.
void test('Issue #314: MyMonthCalendar composes the shared month-calendar-grid classes', () => {
  const css = readFileSync(localCssPath, 'utf8');
  const sharedClasses = [
    'calendar',
    'header',
    'monthLabel',
    'monthNavButton',
    'navChevron',
    'grid',
    'weekdayRow',
    'weekday',
    'week',
    'day',
    'dayOutside',
    'daySelected',
    'dayNumberRow',
    'dayNumber',
    'today',
    'roleSaturday',
    'roleSunday',
    'roleHoliday',
    'coverageNotice',
  ];
  for (const className of sharedClasses) {
    assert.match(
      css,
      new RegExp(
        '\\.' +
          className +
          '\\s*\\{\\s*composes:\\s*' +
          className +
          '\\s+from\\s+[\'"][^\'"]*monthCalendarGrid\\.module\\.css[\'"];',
      ),
      `.${className} must compose from monthCalendarGrid.module.css`,
    );
  }
});

// --- Issue #196: legend vocabulary synced to the row Badge's own labels ---

void test('the participation legend rows reuse participationStatusLabel, never a literal string that could drift from the row Badge', () => {
  const sourcePath = fileURLToPath(new URL('../MyMonthCalendar.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /variantClass: 'dotFilled',\s*label: participationStatusLabel\('attending'\)/,
  );
  assert.match(
    source,
    /variantClass: 'dotOutline',\s*label: participationStatusLabel\('considering'\)/,
  );
  assert.doesNotMatch(source, /決まっている|検討中/);
});

void test('the Personal Schedule swatch legend vocabulary is untouched by the #196 participation-label sync', () => {
  const sourcePath = fileURLToPath(new URL('../MyMonthCalendar.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /label: '予定を確保する'/);
  assert.match(source, /label: '確保しない'/);
});
