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

void test('Catalog heading row top-aligns PageHeading with the loading and bare page headings', () => {
  const headingRow = css.match(/(?:^|\n)\.headingRow\s*\{([^}]*)\}/);
  assert.ok(headingRow, '.headingRow rule is missing from CatalogView.module.css');
  assert.match(headingRow[1] ?? '', /align-items:\s*flex-start\s*;/);
  assert.doesNotMatch(headingRow[1] ?? '', /align-items:\s*center\s*;/);
});

// --- Issue #172 root cause C: applied-filter zero-result feedback ---

void test('isFilteredZero is derived from the same filteredEvents, independent of selectedDate (no second filter predicate)', () => {
  assert.match(
    component,
    /const isFilteredZero = !isEmptyRange && isFilterActive && filteredEvents\.length === 0;/,
  );
});

void test('the filtered-zero StatePanel shows whenever isFilteredZero, with no selectedDate gate (orchestrator merge-fence follow-up)', () => {
  assert.match(component, /\{isFilteredZero \? \(\s*<StatePanel\s*\n\s*variant="empty"/);
  assert.match(component, /条件に合うイベントがありません/);
});

void test('the filtered-zero message is a distinct string from the raw-range-empty message (Issue #195/#187 canonical copy)', () => {
  assert.match(component, /この月に登録されているイベントはありません/);
  assert.match(component, /条件に合うイベントがありません/);
  assert.notEqual(
    /この月に登録されているイベントはありません/.exec(component)?.[0],
    /条件に合うイベントがありません/.exec(component)?.[0],
  );
});

void test('the filtered-zero message reuses filteredEvents, never a second filter predicate', () => {
  const filterCalls = component.match(/filterCatalogEvents\(/g) ?? [];
  assert.equal(filterCalls.length, 1, 'still exactly one filterCatalogEvents call site');
});

void test('the filtered-zero StatePanel carries a 条件を解除する action wired to the same clear handler as the summary row', () => {
  assert.match(component, /条件を解除する/);
  const clearUses = component.match(/onClick=\{handleClearFilter\}/g) ?? [];
  assert.equal(
    clearUses.length,
    2,
    'both the summary row × control and the filtered-zero action must reuse handleClearFilter',
  );
});

void test('EventLevelFallbackList/SelectedDayList are suppressed while the whole filtered range is zero, so the generic per-day empty state never stands in as the only explanation', () => {
  assert.match(
    component,
    /\{selectedDate !== null && !isFilteredZero \? \(\s*<>\s*<EventLevelFallbackList/,
  );
});

// --- Issue #195: ActionRow removal / applied-filter summary row / clear ---

void test('CatalogView no longer accepts or renders an actionRow prop - Issue #193 My Page is the reachable destination now', () => {
  assert.doesNotMatch(component, /actionRow/);
});

void test("handleClearFilter clears through FilterSheet's own imperative handle, never re-deriving applied/draft state locally", () => {
  assert.match(component, /const filterSheetRef = useRef<FilterSheetHandle>\(null\);/);
  const handler = component.match(
    /const handleClearFilter = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/,
  );
  assert.ok(handler, 'handleClearFilter is missing');
  assert.match(handler[1] ?? '', /filterSheetRef\.current\?\.clear\(\);/);
});

void test('the applied-filter summary row only renders while isFilterActive, and reads filterSummary (derived from appliedSelection) - never draft', () => {
  assert.match(
    component,
    /\{isFilterActive && filterSummary !== null \? \(\s*<div className=\{styles\.summaryRow\}>/,
  );
  const summaryMemo = component.match(
    /const filterSummary = useMemo\(\s*\(\) =>\s*filterData\.ok\s*\? catalogFilterSummary\(\s*appliedSelection,/,
  );
  assert.ok(summaryMemo, 'filterSummary must be derived from appliedSelection, not a draft value');
});

void test('the summary row genre label is visually distinguished (600) from the lower-facet label (regular)', () => {
  assert.match(component, /className=\{styles\.summaryGenre\}>\{filterSummary\.genreLabel\}/);
  assert.match(css, /\.summaryGenre\s*\{[^}]*font-weight: var\(--font-weight-semibold\);/);
  assert.match(css, /\.summaryLower\s*\{[^}]*font-weight: var\(--font-weight-regular\);/);
});

void test('the summary row × control has an accessible name distinct from the filter button itself', () => {
  assert.match(component, /aria-label="絞り込みを解除"/);
});

void test('the summary row carries top/bottom hairlines and no fill', () => {
  const rowRule = css.match(/(?:^|\n)\.summaryRow\s*\{([^}]*)\}/);
  assert.ok(rowRule, '.summaryRow rule is missing from CatalogView.module.css');
  assert.match(rowRule[1] ?? '', /border-block:\s*1px solid var\(--color-border\)\s*;/);
  assert.doesNotMatch(rowRule[1] ?? '', /background-color/);
  assert.match(rowRule[1] ?? '', /min-height:\s*44px\s*;/);
});

void test('the summary row clear control is a 30px visible fill using the text-secondary token', () => {
  const clearRule = css.match(/(?:^|\n)\.summaryClear\s*\{([^}]*)\}/);
  assert.ok(clearRule, '.summaryClear rule is missing from CatalogView.module.css');
  assert.match(clearRule[1] ?? '', /width:\s*30px\s*;/);
  assert.match(clearRule[1] ?? '', /height:\s*30px\s*;/);
  assert.match(clearRule[1] ?? '', /color:\s*var\(--color-text-secondary\)\s*;/);
});
