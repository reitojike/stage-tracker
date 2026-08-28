import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/CSS/state
// contract by reading the source rather than rendering it - same approach as
// TriStateCheckbox.test.ts and MonthCalendar.test.ts.
const componentPath = fileURLToPath(new URL('../FilterSheet.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../FilterSheet.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('renders a native <dialog> - real modal focus trap/Escape-to-dismiss/::backdrop, no hand-rolled overlay', () => {
  assert.match(component, /<dialog\b/);
  assert.match(component, /dialogRef\.current\.showModal\(\)|dialog\.showModal\(\)/);
});

void test('Escape/backdrop dismissal only fires onOpenChange, never touches applied state', () => {
  const onCloseHandler = component.match(/onClose=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(onCloseHandler, 'dialog is missing an onClose handler');
  assert.match(onCloseHandler[1] ?? '', /onOpenChange\(false\)/);
  assert.doesNotMatch(onCloseHandler[1] ?? '', /setApplied/);
});

void test('a backdrop click (target is the dialog itself, never a child) closes without committing', () => {
  assert.match(component, /event\.target === dialogRef\.current/);
});

void test('the sheet open transition copies applied into draft, never the reverse', () => {
  const openEffect = component.match(
    /useEffect\(\(\) => \{\s*if \(open\) \{\s*setDraft\(applied\);/,
  );
  assert.ok(openEffect, 'open->draft copy effect is missing or does not read applied into draft');
});

void test('every in-sheet option interaction calls setDraft, never setApplied directly', () => {
  const bodySection = component.split('const [applied')[1];
  assert.ok(bodySection);
  // setApplied only appears in the mount-restore effect and confirm() -
  // neither is an onChange handler for an option row.
  const setAppliedCalls = bodySection.match(/setApplied\(/g) ?? [];
  assert.equal(setAppliedCalls.length, 2);
});

void test('confirm persists to localStorage, commits draft to applied, and reports the derived CatalogFilterSelection', () => {
  const confirmFn = component.match(/function confirm\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(confirmFn, 'confirm() is missing');
  const body = confirmFn[1] ?? '';
  assert.match(
    body,
    /window\.localStorage\.setItem\(CATALOG_FILTER_STORAGE_KEY, serializeCatalogFilterState\(draft\)\)/,
  );
  assert.match(body, /setApplied\(draft\)/);
  assert.match(body, /onAppliedSelectionChange\(toCatalogFilterSelection\(draft\)\)/);
});

void test('genre selection is a single radiogroup sharing one radio input name (single-select)', () => {
  assert.match(component, /role="radiogroup"/);
  const radioNames = component.match(/type="radio"\s*\n\s*name="([^"]+)"/g) ?? [];
  assert.ok(radioNames.length >= 2, 'expected at least the すべて option plus one genre radio');
  const distinctNames = new Set(
    [...component.matchAll(/name="(catalog-filter-genre)"/g)].map((match) => match[1]),
  );
  assert.equal(distinctNames.size, 1);
});

void test('すべて is a synthetic UI option (genre: null), not a fabricated genre row from `genres`', () => {
  assert.match(component, /checked=\{draft\.genre === null\}/);
  assert.match(component, />すべて<\/span>/);
});

void test('secondary facet section only renders when the active genre has one (すべて has none)', () => {
  assert.match(component, /facetKind !== null \? \(/);
});

void test('the aggregate すべて control only appears when there are known options for the active facet', () => {
  assert.match(component, /secondaryOptions\.length > 0 \? \(\s*<TriStateCheckbox/);
});

void test('individual secondary options render as plain checked/unchecked, never indeterminate', () => {
  assert.match(
    component,
    /state=\{selectedValues\.includes\(option\.value\) \? 'checked' : 'unchecked'\}/,
  );
});

void test('no favorites/★ affordance is rendered (Gate A defer, #158 supersedes the old handoff)', () => {
  assert.doesNotMatch(component, /★|favorite/i);
});

void test('no result count is displayed', () => {
  assert.doesNotMatch(component, /[0-9０-９]+件|count/i);
});

void test('exactly one filled primary action exists (the bottom confirm button)', () => {
  const primaryButtons = component.match(/variant="primary"/g) ?? [];
  assert.equal(primaryButtons.length, 1);
  assert.match(component, /この条件で絞り込む/);
});

void test('stale saved values are pruned against the known option universe before ever reaching applied state', () => {
  assert.match(component, /pruneStaleCatalogFilterState\(/);
});

void test('a corrupt/unavailable localStorage read never throws - falls back to empty state', () => {
  const restoreEffect = component.match(
    /useEffect\(\(\) => \{\s*let restored[\s\S]*?\n {2}\}, \[\]\);/,
  );
  assert.ok(restoreEffect, 'mount-time restore effect is missing');
  assert.match(restoreEffect[0], /try \{/);
  assert.match(restoreEffect[0], /catch \{/);
});

void test('the sheet is anchored to the bottom viewport edge with only the top corners rounded', () => {
  const dialogRule = css.match(/(?:^|\n)\.dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, '.dialog rule is missing from FilterSheet.module.css');
  assert.match(dialogRule[1] ?? '', /inset-block-end:\s*0\s*;/);
  assert.match(dialogRule[1] ?? '', /border-start-start-radius:\s*var\(--radius-sheet\)\s*;/);
  assert.match(dialogRule[1] ?? '', /border-start-end-radius:\s*var\(--radius-sheet\)\s*;/);
  assert.match(dialogRule[1] ?? '', /border-top:\s*1px solid var\(--color-border\)\s*;/);
});

void test('open/close transitions ease-out over ~200ms', () => {
  assert.match(css, /transform 200ms ease-out/);
});

void test('the backdrop is a dark scrim behind the sheet', () => {
  assert.match(css, /\.dialog::backdrop\s*\{/);
});

void test('genre/option rows meet the 44px tap target and suppress double-tap zoom', () => {
  const rowRule = css.match(/(?:^|\n)\.row\s*\{([^}]*)\}/);
  assert.ok(rowRule, '.row rule is missing from FilterSheet.module.css');
  assert.match(rowRule[1] ?? '', /min-height:\s*44px\s*;/);
  assert.match(rowRule[1] ?? '', /touch-action:\s*manipulation\s*;/);
});

void test('the confirm button fills the sheet width as the sole filled action', () => {
  const confirmButtonRule = css.match(/(?:^|\n)\.confirmButton\s*\{([^}]*)\}/);
  assert.ok(confirmButtonRule, '.confirmButton rule is missing from FilterSheet.module.css');
  assert.match(confirmButtonRule[1] ?? '', /width:\s*100%\s*;/);
});
