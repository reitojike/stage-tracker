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
const sheetCssPath = fileURLToPath(new URL('../../../../ui/Sheet.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const sheetCss = readFileSync(sheetCssPath, 'utf8');

void test('composes the shared Sheet for dialog lifecycle and the Filter-specific footer slot', () => {
  assert.match(component, /import \{ Sheet \} from '@\/ui\/Sheet';/);
  assert.match(component, /<Sheet\b/);
  assert.match(component, /title="絞り込み"/);
  assert.match(component, /bodyClassName=\{styles\.body\}/);
  assert.match(component, /footer=\{/);
  assert.match(component, /showCloseButton=\{false\}/);
  assert.doesNotMatch(component, /<dialog\b|showModal\(\)|dialogRef|useId/);
});

void test('FilterSheet delegates Escape/backdrop dismissal to Sheet and keeps confirm as its only close request', () => {
  const sheetProps = component.match(/<Sheet([\s\S]*?)>/);
  assert.ok(sheetProps, 'FilterSheet is missing its shared Sheet composition');
  assert.match(sheetProps[1] ?? '', /open=\{open\}/);
  assert.match(sheetProps[1] ?? '', /onOpenChange=\{onOpenChange\}/);
  assert.doesNotMatch(component, /onClose=|event\.target ===|\.close\(\)|showModal\(\)/);
  assert.match(component, /onOpenChange\(false\)/);
});

void test('Filter-specific body and footer are passed as Sheet slots, keeping footer outside the scrollable body', () => {
  const sheetProps = component.match(/<Sheet([\s\S]*?)>/);
  assert.ok(sheetProps, 'FilterSheet is missing its shared Sheet composition');
  assert.match(sheetProps[1] ?? '', /bodyClassName=\{styles\.body\}/);
  assert.match(sheetProps[1] ?? '', /footer=\{/);
  assert.match(component, /<div className=\{styles\.footer\}>/);
});

void test('FilterSheet no longer carries a duplicate shared dialog/frame CSS surface', () => {
  assert.doesNotMatch(css, /(?:^|\n)\.(dialog|sheet|title)\s*\{/);
});

void test('the genre/facet dispatch (secondaryOptionsForFacet vs knownSecondaryValuesByGenre) shares one source: activeSecondaryFacet', () => {
  const facetCalls = component.match(/activeSecondaryFacet\(/g) ?? [];
  // knownSecondaryValuesByGenre, secondaryOptionsForFacet's caller (render
  // body), and the mount-restore effect all resolve a facet through this
  // one function - never re-deriving group-vs-venue dispatch themselves.
  assert.ok(facetCalls.length >= 2);
});

void test('known-option lookups use the `in` operator, never `??` defaulting, so "not loaded yet" stays distinguishable from "loaded, zero options"', () => {
  const knownFn = component.match(/function knownSecondaryValuesByGenre\([\s\S]*?\n\}/);
  assert.ok(knownFn, 'knownSecondaryValuesByGenre is missing');
  assert.match(knownFn[0], /facet\.genreKey in groupOptionsByGenreKey/);
  assert.match(knownFn[0], /facet\.genreKey in venueOptionsByGenreKey/);
});

void test('a value not currently backed by known option data is stripped before being handed to the caller as a live filter (sanitizeForApply)', () => {
  assert.match(component, /function sanitizeForApply\(/);
  assert.match(component, /intersectWithKnownValues\(selected, knownValues\)/);
  // Used at the mount-restore hydration point, confirm(), and the
  // imperative clear() handle's own toCatalogFilterSelection call is
  // EMPTY_CATALOG_FILTER_STATE-based and does not go through
  // sanitizeForApply (there is nothing to sanitize against an already-empty
  // state) - so this stays 3 (the function's own declaration + 2 call
  // sites), unchanged by Issue #195.
  const sanitizeCalls = component.match(/sanitizeForApply\(/g) ?? [];
  assert.equal(sanitizeCalls.length, 3); // the function's own declaration + 2 call sites
});

void test('confirm persists and applies the raw draft (so a not-yet-visible value can still be restored later), while only the reported selection is sanitized', () => {
  const confirmFn = component.match(/function confirm\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(confirmFn, 'confirm() is missing');
  const body = confirmFn[1] ?? '';
  assert.match(
    body,
    /window\.localStorage\.setItem\(CATALOG_FILTER_STORAGE_KEY, serializeCatalogFilterState\(draft\)\)/,
  );
  assert.match(body, /setApplied\(draft\)/);
  assert.match(body, /sanitizeForApply\(draft, activeFacet, knownValues\)/);
});

void test('the sheet open transition copies applied into draft only on a genuine false->true transition, not on every mount', () => {
  assert.match(component, /const wasOpenRef = useRef\(open\);/);
  const transitionEffect = component.match(
    /useEffect\(\(\) => \{\s*const wasOpen = wasOpenRef\.current;[\s\S]*?\n {2}\}, \[open, applied\]\);/,
  );
  assert.ok(
    transitionEffect,
    'open-transition effect is missing or does not match the guarded shape',
  );
  assert.match(transitionEffect[0], /if \(open && !wasOpen\) \{/);
});

void test('the mount-restore effect seeds both applied and draft, so an already-open mount never renders a stale pre-restore draft', () => {
  const restoreEffect = component.match(
    /useEffect\(\(\) => \{\s*let restored[\s\S]*?\n {2}\}, \[\]\);/,
  );
  assert.ok(restoreEffect, 'mount-time restore effect is missing');
  assert.match(restoreEffect[0], /setApplied\(pruned\)/);
  assert.match(restoreEffect[0], /setDraft\(pruned\)/);
});

void test('every in-sheet option interaction calls setDraft, never setApplied directly - setApplied stays confined to the mount-restore effect, confirm(), and the imperative clear() handle', () => {
  const bodySection = component.split('const [applied')[1];
  assert.ok(bodySection);
  const setAppliedCalls = bodySection.match(/setApplied\(/g) ?? [];
  assert.equal(setAppliedCalls.length, 3);
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

void test('secondary facet section only renders when the active genre has one (すべて has none), with no dead null-guard inside its onChange handlers', () => {
  const facetSection = component.match(/\{activeFacet !== null \? \(([\s\S]*?)\n {10}\) : null\}/);
  assert.ok(
    facetSection,
    'active-facet conditional block is missing or does not match the expected shape',
  );
  // activeFacet is narrowed once by the surrounding `activeFacet !== null`
  // conditional - the onChange handlers inside must reuse that narrowed
  // `const activeFacet.genreKey` directly, never re-check
  // `draft.genre === null` (which would be unreachable dead code inside a
  // block already gated on activeFacet !== null).
  assert.doesNotMatch(facetSection[1] ?? '', /draft\.genre === null/);
  assert.match(facetSection[1] ?? '', /activeFacet\.genreKey/);
});

void test("the secondary facet heading distinguishes its multi-select semantics from the genre chips' single-select above (Issue #195)", () => {
  assert.match(component, /\{activeFacet\.label\}（複数選べます）/);
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

void test("exactly one filled primary action exists (the bottom confirm button) - the footer's own クリア action is a separate, lower-emphasis quiet control", () => {
  const primaryButtons = component.match(/variant="primary"/g) ?? [];
  assert.equal(primaryButtons.length, 1);
  assert.match(component, /この条件で絞り込む/);
  assert.match(component, /variant="quiet"/);
  assert.match(component, /条件をクリア/);
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
  const dialogRule = sheetCss.match(/(?:^|\n)\.dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, '.dialog rule is missing from Sheet.module.css');
  assert.match(dialogRule[1] ?? '', /inset-block-end:\s*0\s*;/);
  assert.match(dialogRule[1] ?? '', /border-start-start-radius:\s*var\(--radius-sheet\)\s*;/);
  assert.match(dialogRule[1] ?? '', /border-start-end-radius:\s*var\(--radius-sheet\)\s*;/);
  assert.match(dialogRule[1] ?? '', /border-top:\s*1px solid var\(--color-border\)\s*;/);
});

void test("inset-block-start is explicitly reset to auto, overriding <dialog>'s own UA-stylesheet top:0 default", () => {
  // Regression guard (found via a real headless-Chrome render during Issue
  // #147 visual sanity, not visible from source/CSS text alone): a native
  // dialog:modal's UA stylesheet sets `inset: 0` (top included). Left
  // unset, that top:0 wins over inset-block-end below in the
  // over-constrained top+height+bottom case, pinning the sheet to the top
  // of the viewport instead of the bottom.
  const dialogRule = sheetCss.match(/(?:^|\n)\.dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, '.dialog rule is missing from Sheet.module.css');
  assert.match(dialogRule[1] ?? '', /inset-block-start:\s*auto\s*;/);
});

void test('the sheet surface is the paper canvas token, not the white content-surface fill (Issue #195)', () => {
  const dialogRule = sheetCss.match(/(?:^|\n)\.dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, '.dialog rule is missing from Sheet.module.css');
  assert.match(dialogRule[1] ?? '', /background-color:\s*var\(--color-canvas\)\s*;/);
});

void test('open/close transitions ease-out over ~200ms', () => {
  assert.match(sheetCss, /transform 200ms ease-out/);
});

void test('the backdrop is a dark scrim behind the sheet', () => {
  assert.match(sheetCss, /\.dialog::backdrop\s*\{/);
});

void test('genre chips wrap (never scroll) and meet the 44px tap target', () => {
  const chipsRule = css.match(/(?:^|\n)\.chips\s*\{([^}]*)\}/);
  assert.ok(chipsRule, '.chips rule is missing from FilterSheet.module.css');
  assert.match(chipsRule[1] ?? '', /flex-wrap:\s*wrap\s*;/);
  const chipRule = css.match(/(?:^|\n)\.chip\s*\{([^}]*)\}/);
  assert.ok(chipRule, '.chip rule is missing from FilterSheet.module.css');
  assert.match(chipRule[1] ?? '', /flex:\s*1 1 76px\s*;/);
  assert.match(chipRule[1] ?? '', /min-height:\s*44px\s*;/);
  assert.match(chipRule[1] ?? '', /border-radius:\s*var\(--radius-control\)\s*;/);
  // Unselected chip boundary reuses --color-control-border (WCAG 2.2 SC
  // 1.4.11 3:1-against-canvas token), not a bespoke lighter value - see the
  // CSS's own doc comment above .chip.
  assert.match(chipRule[1] ?? '', /border:\s*1px solid var\(--color-control-border\)\s*;/);
});

void test('the selected chip uses the accent fill / foreground pairing at 600 weight', () => {
  const selectedRule = css.match(/(?:^|\n)\.chipSelected\s*\{([^}]*)\}/);
  assert.ok(selectedRule, '.chipSelected rule is missing from FilterSheet.module.css');
  assert.match(selectedRule[1] ?? '', /background-color:\s*var\(--color-accent\)\s*;/);
  assert.match(selectedRule[1] ?? '', /color:\s*var\(--color-accent-foreground\)\s*;/);
  assert.match(selectedRule[1] ?? '', /font-weight:\s*var\(--font-weight-semibold\)\s*;/);
});

void test('more than 10 known genres falls back to a bounded <select>, not an unbounded chip set', () => {
  assert.match(component, /const MAX_GENRE_CHIPS = 10;/);
  assert.match(component, /genres\.length > MAX_GENRE_CHIPS \? \(\s*\/\/[\s\S]*?<select/);
  assert.match(component, /<option value="">すべて<\/option>/);
});

void test('the footer holds both a quiet draft-only clear action and the primary confirm action, sharing the row', () => {
  const footerRule = css.match(/(?:^|\n)\.footer\s*\{([^}]*)\}/);
  assert.ok(footerRule, '.footer rule is missing from FilterSheet.module.css');
  assert.match(footerRule[1] ?? '', /display:\s*flex\s*;/);
  const confirmButtonRule = css.match(/(?:^|\n)\.confirmButton\s*\{([^}]*)\}/);
  assert.ok(confirmButtonRule, '.confirmButton rule is missing from FilterSheet.module.css');
  assert.match(confirmButtonRule[1] ?? '', /flex:\s*1 1 auto\s*;/);
});

void test('条件をクリア resets draft only - never applied/localStorage - distinct from the imperative clear() handle', () => {
  const clearButtonHandler = component.match(
    /variant="quiet"[\s\S]*?onClick=\{\(\) => \{([\s\S]*?)\}\}/,
  );
  assert.ok(clearButtonHandler, '条件をクリア button onClick handler is missing');
  assert.match(clearButtonHandler[1] ?? '', /setDraft\(EMPTY_CATALOG_FILTER_STATE\)/);
  assert.doesNotMatch(clearButtonHandler[1] ?? '', /setApplied/);
  assert.doesNotMatch(clearButtonHandler[1] ?? '', /localStorage/);
});

void test('FilterSheet is a forwardRef component exposing an imperative clear() handle for the applied-filter summary row (Issue #195)', () => {
  assert.match(
    component,
    /export const FilterSheet = forwardRef<FilterSheetHandle, FilterSheetProps>/,
  );
  assert.match(component, /export interface FilterSheetHandle \{\s*clear: \(\) => void;\s*\}/);
});

void test('clear() resets both applied and draft, persists the empty state, and reports it via onAppliedSelectionChange', () => {
  const clearHandle = component.match(/clear\(\) \{([\s\S]*?)\n {6}\},/);
  assert.ok(clearHandle, 'useImperativeHandle clear() implementation is missing');
  const body = clearHandle[1] ?? '';
  assert.match(body, /setApplied\(EMPTY_CATALOG_FILTER_STATE\)/);
  assert.match(body, /setDraft\(EMPTY_CATALOG_FILTER_STATE\)/);
  assert.match(body, /window\.localStorage\.setItem\(/);
  assert.match(
    body,
    /onAppliedSelectionChange\(toCatalogFilterSelection\(EMPTY_CATALOG_FILTER_STATE\)\)/,
  );
});
