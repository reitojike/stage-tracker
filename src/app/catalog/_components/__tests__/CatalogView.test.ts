import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/state
// contract by reading the source rather than rendering it - same approach as
// FilterSheet.test.ts and MonthCalendar.test.ts.
const componentPath = fileURLToPath(new URL('../CatalogView.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../CatalogView.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('one filterCatalogEvents result feeds MonthCalendar, EventLevelFallbackList, and SelectedDayList alike - never a per-surface re-filter', () => {
  assert.match(component, /const filteredEvents = useMemo\(/);
  assert.match(component, /buildMonthCalendarViewModel\(yearMonth, filteredEvents\)/);
  assert.match(component, /selectEventLevelFallback\(filteredEvents, selectedDate\)/);
  assert.match(component, /selectDayOccurrences\(filteredEvents, selectedDate\)/);
  // Guards against a future edit re-introducing a second, independent
  // filterCatalogEvents call for one of the three surfaces (split-brain).
  const filterCalls = component.match(/filterCatalogEvents\(/g) ?? [];
  assert.equal(filterCalls.length, 1);
});

void test('the calendar/list body only renders once selectionReady is true (or there is nothing that could be wrong about the content) - never a default/unfiltered flash before FilterSheet restores', () => {
  assert.match(component, /const \[selectionReady, setSelectionReady\] = useState\(false\)/);
  assert.match(
    component,
    /const readyToRenderBody = !filterData\.ok \|\| selectionReady \|\| isEmptyRange;/,
    'unavailable filter data or a genuinely empty range must render immediately; otherwise wait for selectionReady',
  );
  assert.match(component, /\{readyToRenderBody \? \(/);
});

void test('onAppliedSelectionChange is the only place selectionReady flips true, and it always also records the selection', () => {
  const handler = component.match(
    /const handleAppliedSelectionChange = useCallback\(\(selection: CatalogFilterSelection\) => \{([\s\S]*?)\}, \[\]\);/,
  );
  assert.ok(handler, 'handleAppliedSelectionChange is missing');
  assert.match(handler[1] ?? '', /setAppliedSelection\(selection\)/);
  assert.match(handler[1] ?? '', /setSelectionReady\(true\)/);
  const readySetters = component.match(/setSelectionReady\(/g) ?? [];
  assert.equal(
    readySetters.length,
    1,
    'setSelectionReady must only ever be called from the FilterSheet callback',
  );
});

void test('the active dot follows applied selection only, never draft state, and only once ready', () => {
  assert.match(
    component,
    /const isFilterActive = filterData\.ok && selectionReady && appliedSelection\.genre !== null;/,
  );
  assert.match(
    component,
    /\{isFilterActive \? <span aria-hidden="true" className=\{styles\.activeDot\} \/> : null\}/,
  );
});

void test('the filter button carries a state-reflecting aria-label, not only the visual dot, as its accessible cue', () => {
  assert.match(component, /aria-label=\{isFilterActive \? '絞り込み（適用中）' : '絞り込み'\}/);
});

void test('filter data unavailability disables the button and skips mounting FilterSheet, while still showing an explicit unavailable notice', () => {
  assert.match(component, /const canOpenSheet = filterData\.ok;/);
  assert.match(component, /aria-disabled=\{canOpenSheet \? undefined : true\}/);
  assert.match(component, /\{filterData\.ok \? \(\s*<FilterSheet/);
  assert.match(component, /variant="unavailable"/);
});

void test("CatalogView.module.css defines the active dot as a supplementary (non-sole) cue, matching AppBar's own unread-dot presentation", () => {
  assert.match(css, /\.activeDot\s*\{/);
  assert.match(css, /background-color: var\(--color-accent\);/);
});
