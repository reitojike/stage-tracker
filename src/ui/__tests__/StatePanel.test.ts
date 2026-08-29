import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/CSS
// contract by reading the source rather than rendering it - same approach as
// TriStateCheckbox.test.ts's source/CSS regex guards.
const componentPath = fileURLToPath(new URL('../StatePanel.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../StatePanel.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

void test('action is optional and has no default - existing callers that omit it stay unaffected', () => {
  assert.match(component, /action\?:\s*ReactNode/);
});

void test('title, description, and action always render in the same order regardless of variant', () => {
  // A single JSX return with no per-variant branch - empty/error/unavailable
  // share one structural composition (Issue #187).
  const titleIndex = component.indexOf('styles.title');
  const descriptionIndex = component.indexOf('styles.description');
  const actionIndex = component.indexOf('{action}');
  assert.ok(titleIndex >= 0 && descriptionIndex >= 0 && actionIndex >= 0);
  assert.ok(titleIndex < descriptionIndex);
  assert.ok(descriptionIndex < actionIndex);
  assert.doesNotMatch(component, /variant === '(empty|error|unavailable)' \? \(/);
});

void test('error keeps role="alert" for a11y announcement, but this is the only variant-conditional branch', () => {
  assert.match(component, /role=\{variant === 'error' \? 'alert' : 'status'\}/);
});

void test('the component and its CSS never reference --color-danger - red is deadline-only, not error (Issue #187)', () => {
  assert.doesNotMatch(component, /color-danger/);
  assert.doesNotMatch(css, /color-danger/);
});

void test('no per-variant CSS rule exists - .empty/.error/.unavailable no longer diverge in styling', () => {
  assert.doesNotMatch(css, /\.empty\s*\{/);
  assert.doesNotMatch(css, /\.error\s*\{/);
  assert.doesNotMatch(css, /\.unavailable\s*\{/);
});

void test('the panel uses a shared top/bottom hairline, not a filled card background', () => {
  const panelRule = css.match(/(?:^|\n)\.panel\s*\{([^}]*)\}/);
  assert.ok(panelRule, '.panel rule is missing from StatePanel.module.css');
  assert.match(panelRule[1] ?? '', /border-block:\s*1px solid var\(--color-border\)\s*;/);
  assert.doesNotMatch(panelRule[1] ?? '', /background-color/);
});
