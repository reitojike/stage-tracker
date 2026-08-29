import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Source-text guard (no jsdom/RTL in this toolchain), same convention as
// FilterSheet.test.ts/MonthCalendar.test.ts.
const componentPath = fileURLToPath(new URL('../SelectedDayList.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../SelectedDayList.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('rows no longer use the Surface card component (Issue #145: line + separator layout)', () => {
  assert.doesNotMatch(component, /Surface/);
  assert.doesNotMatch(css, /\bborder-radius\b/);
});

void test('CSS separates rows with a 1px border between consecutive items, not a per-row card', () => {
  assert.match(css, /\.items > li \+ li \{[\s\S]*?border-top: 1px solid var\(--color-border\);/);
});

void test('the classification badge uses the shared genre/lower authority (classificationBadgeLabel), with variant="outline"', () => {
  assert.match(
    component,
    /import \{ classificationBadgeLabel \} from '@\/domain\/catalogFilterIntegration\.ts';/,
  );
  assert.match(
    component,
    /classificationBadgeLabel\(\s*classificationByEventId\.get\(event\.id\) \?\? null,\s*event\.venue,\s*\)/,
  );
  assert.match(component, /<Badge variant="outline">\{badgeLabel\}<\/Badge>/);
});

void test('no badge renders for an unclassified event (badgeLabel === null short-circuits the badge span)', () => {
  assert.match(component, /badgeLabel !== null \|\| canceled \? \(/);
});

void test('the existing 中止 terminal badge is preserved, driven by isEffectivelyCanceled (Event OR Occurrence)', () => {
  assert.match(component, /isEffectivelyCanceled\(event, occurrence\)/);
  assert.match(component, /<Badge variant="terminal">中止<\/Badge>/);
});

void test('classificationByEventId is a required prop (this component is Catalog-only, not shared with My Calendar)', () => {
  assert.match(component, /classificationByEventId: ReadonlyMap<string, EventClassification>;/);
});

// --- Issue #189: shared day-role/date label authority, not a local one ---

void test('the selected-day heading reuses the shared calendarDayRole authority and DayRoleText, never re-deriving weekday/holiday judgment locally', () => {
  assert.match(component, /import \{\s*DayRoleText\s*\} from '@\/ui\/DayRoleText'/);
  assert.match(
    component,
    /calendarDateAccessibleWeekdayLabel|calendarDateWeekdayLabel|calendarDayRole/,
  );
  assert.doesNotMatch(component, /getUTCDay|getDay\(\)/);
});

void test('the DayRoleText role and the section aria-label are both wired to date, not to an unrelated or swapped value', () => {
  assert.match(component, /<DayRoleText[\s\S]{0,40}role=\{calendarDayRole\(date\)\}/);
  assert.match(component, /calendarDateAccessibleWeekdayLabel\(date\)/);
});
