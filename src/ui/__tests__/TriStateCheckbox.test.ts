import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/CSS
// contract by reading the source rather than rendering it - same approach as
// ScheduleFields.test.ts's `.fields[hidden]` guard.
const componentPath = fileURLToPath(new URL('../TriStateCheckbox.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../TriStateCheckbox.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('renders a native type="checkbox" input so Tab/Space keyboard operation is free', () => {
  assert.match(component, /type="checkbox"/);
});

void test('exposes indeterminate via aria-checked="mixed" and the DOM indeterminate property', () => {
  assert.match(component, /aria-checked=\{state === 'indeterminate' \? 'mixed' : undefined\}/);
  assert.match(component, /inputRef\.current\.indeterminate = state === 'indeterminate'/);
});

void test('the indeterminate DOM property commits via useLayoutEffect, not useEffect, so an indeterminate initial mount never paints as plain unchecked', () => {
  assert.match(component, /useLayoutEffect\(\(\) => \{/);
  assert.doesNotMatch(component, /\buseEffect\(/);
});

void test('checked and indeterminate are told apart by shape, not just color: check mark vs bar', () => {
  assert.match(component, /state === 'checked' \? \(\s*<svg/);
  assert.match(
    component,
    /state === 'indeterminate' \? <span className=\{styles\.dash\} \/> : null/,
  );
});

void test('unchecked never appends an undefined class token to the visible box', () => {
  // Regression guard: styles[state] for 'unchecked' would resolve to
  // `undefined` at runtime (there is no .unchecked CSS class - the base
  // .box style already covers it), so the className builder must not
  // blindly look that up.
  assert.doesNotMatch(component, /styles\[STATE_CLASS/);
  assert.match(component, /state === 'unchecked' \? undefined : styles\[state\]/);
});

void test('disabled forwards onto the native input, not just a wrapper style', () => {
  assert.match(component, /disabled=\{disabled\}/);
});

void test('the tap target is the whole row (min-height 44px), not just the visible 18px box', () => {
  const rowRule = css.match(/(?:^|\n)\.row\s*\{([^}]*)\}/);
  assert.ok(rowRule, '.row rule is missing from TriStateCheckbox.module.css');
  assert.match(rowRule[1] ?? '', /min-height:\s*44px\s*;/);
});

void test('the row suppresses the mobile double-tap-zoom delay like every other tap target', () => {
  const rowRule = css.match(/(?:^|\n)\.row\s*\{([^}]*)\}/);
  assert.ok(rowRule, '.row rule is missing from TriStateCheckbox.module.css');
  assert.match(rowRule[1] ?? '', /touch-action:\s*manipulation\s*;/);
});

void test('the visible box is 18px with a 1px border, independent of checked/indeterminate fill', () => {
  const boxRule = css.match(/(?:^|\n)\.box\s*\{([^}]*)\}/);
  assert.ok(boxRule, '.box rule is missing from TriStateCheckbox.module.css');
  assert.match(boxRule[1] ?? '', /width:\s*18px\s*;/);
  assert.match(boxRule[1] ?? '', /height:\s*18px\s*;/);
  assert.match(boxRule[1] ?? '', /border:\s*1px solid var\(--color-control-border\)\s*;/);
});

void test('checked/indeterminate share the same accent fill, distinguished only by their glyph', () => {
  const fillRule = css.match(/\.checked,\s*\n\.indeterminate\s*\{([^}]*)\}/);
  assert.ok(fillRule, '.checked, .indeterminate rule is missing from TriStateCheckbox.module.css');
  assert.match(fillRule[1] ?? '', /background-color:\s*var\(--color-accent\)\s*;/);
});

void test('the real input is visually hidden (not display:none) so it stays focusable', () => {
  const inputRule = css.match(/(?:^|\n)\.input\s*\{([^}]*)\}/);
  assert.ok(inputRule, '.input rule is missing from TriStateCheckbox.module.css');
  assert.doesNotMatch(inputRule[1] ?? '', /display:\s*none/);
  assert.match(inputRule[1] ?? '', /clip:\s*rect\(0,\s*0,\s*0,\s*0\)\s*;/);
});
