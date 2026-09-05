import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No render harness exists for this component (see MyMonthCalendar.test.ts /
// MonthCalendar.test.ts for the same source-assertion pattern this repo
// already uses in place of one), so this guards the exact regression PO
// review Finding 2 (#107) found: without occurrence.id as catalogEventHref's
// third argument, My Calendar's selected-day row silently drops exact
// Occurrence identity on the way to the shared Event detail page, even
// though the Event Catalog's own SelectedDayList carries it correctly.
const sourcePath = fileURLToPath(new URL('../MySelectedDayList.tsx', import.meta.url));
const rowSourcePath = fileURLToPath(new URL('../MyCalendarEntryRow.tsx', import.meta.url));

void test('the shared occurrence row link carries occurrence.id to catalogEventHref, matching the Event Catalog SelectedDayList exact-Occurrence navigation contract', () => {
  const source = readFileSync(rowSourcePath, 'utf8');
  assert.match(
    source,
    /catalogEventHref\(event\.id,\s*eventDetailContext,\s*occurrence\.id\)/,
    "MyCalendarEntryRow must pass occurrence.id as catalogEventHref's third argument",
  );
});

void test('MySelectedDayList delegates occurrence and schedule rows to the shared presenter', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /import \{\s*MyCalendarEntryRow\s*\}/);
  assert.match(source, /kind: 'occurrence'/);
  assert.match(source, /kind: 'schedule'/);
});

// --- Issue #189: shared day-role/date label authority, not a local one ---

void test('the selected-day heading reuses the shared calendarDayRole authority and DayRoleText, never re-deriving weekday/holiday judgment locally', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /import \{\s*DayRoleText\s*\} from '@\/ui\/DayRoleText'/);
  assert.match(
    source,
    /calendarDateAccessibleWeekdayLabel|calendarDateWeekdayLabel|calendarDayRole/,
  );
  assert.doesNotMatch(source, /getUTCDay|getDay\(\)/);
});

void test('the DayRoleText role and the section aria-label are both wired to date, not to an unrelated or swapped value', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /<DayRoleText[\s\S]{0,40}role=\{calendarDayRole\(date\)\}/);
  assert.match(source, /calendarDateAccessibleWeekdayLabel\(date\)/);
});

// --- Issue #196: selected-day add row / empty-state primary add action ---

void test('the empty selected-day state shows the #196 copy and a primary add action, not the old quiet empty panel', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /この日の予定はまだありません/);
  assert.doesNotMatch(source, /この日に登録されている予定はありません/);
  assert.match(source, /<StatePanel[\s\S]{0,120}variant="empty"[\s\S]{0,200}action=\{<LinkButton/);
});

void test('both the empty-state action and the trailing add row link to scheduleNewHrefForDate(date), not a hand-built href', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /import \{\s*scheduleNewHrefForDate\s*\} from '@\/domain\/myCalendarNavigation\.ts'/,
  );
  assert.match(source, /const addHref = scheduleNewHrefForDate\(date\);/);
  const addHrefUsages = source.match(/href=\{addHref\}/g) ?? [];
  assert.equal(
    addHrefUsages.length,
    2,
    'addHref must be used by both the empty-state action and the trailing add row',
  );
});

void test('the trailing add row carries its own addRow class (closing hairline) and a "+" icon, not the shared .item row shape', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /<li className=\{styles\.addRow\}>/);
  assert.match(source, /className=\{styles\.addRowLink\}/);
  assert.match(source, />\s*\+\s*<\/span>/);
});

void test('the add-row copy is date-specific ("{M月D日}に予定を追加"), reusing myCalendarMonthDayLabel rather than a generic label', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /const addLabel = `\$\{myCalendarMonthDayLabel\(date\)\}に予定を追加`;/);
});

void test('Issue #315: the badge row is the shared badges presentation plus this screen’s own offset', () => {
  // Moved here from Row.test.ts (Issue #312): the shared selected-day
  // presentation and its consumer wiring live in
  // src/ui/__tests__/selectedDayList.test.ts, but `.badgeRow` is My
  // Calendar's own class - it composes the shared badges rule and adds the
  // gap above it that only this screen needs.
  const cssPath = fileURLToPath(new URL('../MySelectedDayList.module.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8');
  const badgeRow = /\.badgeRow\s*\{([^}]*)\}/.exec(css);
  assert.ok(badgeRow, '.badgeRow rule not found');
  assert.match(
    badgeRow[1] ?? '',
    /composes:\s*badges\s+from\s+['"][^'"]*selectedDayList\.module\.css['"]/,
  );
  assert.match(badgeRow[1] ?? '', /margin-top:\s*var\(--space-2xs\);/);
});

void test('.addRow sets only border-bottom, not border-top (review fix: .addRow always follows an .item, whose own :not(:last-child) rule already supplies the border between them - a border-top here would double that hairline)', () => {
  const cssPath = fileURLToPath(new URL('../MySelectedDayList.module.css', import.meta.url));
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const addRowRule = /\.addRow\s*\{([^}]*)\}/.exec(css);
  assert.ok(addRowRule, '.addRow rule not found');
  assert.match(addRowRule[1] ?? '', /border-bottom:\s*1px solid/);
  assert.doesNotMatch(addRowRule[1] ?? '', /border-top/);
});
