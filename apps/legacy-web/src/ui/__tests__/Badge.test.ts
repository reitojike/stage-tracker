import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/CSS
// contract by reading the source rather than rendering it - same approach as
// TriStateCheckbox.test.ts's guard.
const componentPath = fileURLToPath(new URL('../Badge.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../Badge.module.css', import.meta.url));
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule is missing from Badge.module.css`);
  return match[1] ?? '';
}

void test('Issue #186: BadgeVariant is a typed 5-value union - outline/subtle/done/deadline/terminal', () => {
  assert.match(
    component,
    /export type BadgeVariant = 'outline' \| 'subtle' \| 'done' \| 'deadline' \| 'terminal';/,
  );
});

void test('done is wired into VARIANT_CLASS like every other variant (no fallback to undefined className)', () => {
  assert.match(component, /done: 'done',/);
});

void test('the done checkmark is component-owned, not part of the caller label', () => {
  // The component itself renders the glyph when variant === 'done' - callers
  // never need (and per Issue #186 must not) embed "✓" in their own label
  // strings for this to appear.
  assert.match(component, /variant === 'done' \? <span aria-hidden="true">✓ <\/span> : null/);
});

void test('the checkmark is aria-hidden so the accessible name is just the label, not "check mark <label>"', () => {
  assert.match(component, /<span aria-hidden="true">✓ <\/span>/);
});

void test('done reuses the existing calendar band tokens - no new color value introduced', () => {
  const rule = cssRule('.done');
  assert.match(rule, /background-color:\s*var\(--color-band-fill\)\s*;/);
  assert.match(rule, /color:\s*var\(--color-band-text\)\s*;/);
});

void test('regression guard: existing outline/subtle/deadline/terminal rules are unchanged', () => {
  const outline = cssRule('.outline');
  assert.match(outline, /border-color:\s*var\(--color-control-border\)\s*;/);
  assert.match(outline, /color:\s*var\(--color-text-tertiary\)\s*;/);
  assert.match(outline, /background-color:\s*transparent\s*;/);

  const subtle = cssRule('.subtle');
  assert.match(subtle, /background-color:\s*var\(--color-surface-subtle\)\s*;/);
  assert.match(subtle, /color:\s*var\(--color-text-tertiary\)\s*;/);

  const deadline = cssRule('.deadline');
  assert.match(deadline, /background-color:\s*var\(--color-danger\)\s*;/);
  assert.match(deadline, /color:\s*var\(--color-danger-on\)\s*;/);

  const terminal = cssRule('.terminal');
  assert.match(terminal, /background-color:\s*var\(--color-terminal\)\s*;/);
  assert.match(terminal, /color:\s*var\(--color-terminal-on\)\s*;/);
});

void test('regression guard: shared badge sizing/shape (padding/radius/font) is untouched by the 5th variant', () => {
  const base = cssRule('.badge');
  assert.match(base, /border-radius:\s*var\(--radius-badge\)\s*;/);
  assert.match(base, /padding:\s*3px 8px\s*;/);
  assert.match(base, /font-size:\s*11px\s*;/);
});
