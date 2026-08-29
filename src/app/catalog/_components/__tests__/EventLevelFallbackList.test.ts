import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Source-text guard (no jsdom/RTL in this toolchain), same convention as
// FilterSheet.test.ts/MonthCalendar.test.ts.
const componentPath = fileURLToPath(new URL('../EventLevelFallbackList.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../EventLevelFallbackList.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('Event range presentation reuses the date-only Catalog formatter instead of echoing ISO values', () => {
  assert.match(
    component,
    /import \{ eventDateRangeLabel \} from '@\/domain\/catalogFormatting\.ts';/,
  );
  assert.match(component, /eventDateRangeLabel\(event\.startsOn, event\.endsOn\)/);
  assert.doesNotMatch(component, /\{event\.startsOn\}〜\{event\.endsOn\}/);
});

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

void test('classificationByEventId is optional, defaulting to an empty map - My Calendar (src/app/calendar/page.tsx) reuses this component without classification data', () => {
  assert.match(component, /classificationByEventId\?: ReadonlyMap<string, EventClassification>;/);
  assert.match(
    component,
    /const NO_CLASSIFICATIONS: ReadonlyMap<string, EventClassification> = new Map\(\);/,
  );
  assert.match(component, /classificationByEventId = NO_CLASSIFICATIONS/);
});

void test('the existing 中止 terminal badge is preserved, driven by isEventCanceled (Event-level only - a band has no per-occurrence meaning)', () => {
  assert.match(component, /isEventCanceled\(event\)/);
  assert.match(component, /<Badge variant="terminal">中止<\/Badge>/);
});

void test('#109 complement semantics are unchanged: this still returns null on an empty candidate list rather than rendering an empty section', () => {
  assert.match(component, /if \(events\.length === 0\) \{\s*return null;\s*\}/);
});
