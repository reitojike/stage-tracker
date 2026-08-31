import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const component = readFileSync(
  fileURLToPath(new URL('../WriteNotice.tsx', import.meta.url)),
  'utf8',
);
const css = readFileSync(
  fileURLToPath(new URL('../WriteNotice.module.css', import.meta.url)),
  'utf8',
);

void test('shared notice keeps a stable polite status region and attempt-keyed message', () => {
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /notice !== null/);
  assert.match(component, /<p key=\{attempt\}/);
  assert.match(css, /\.noticeRegion:empty/);
  assert.match(css, /var\(--color-surface-subtle\)/);
  assert.match(css, /var\(--radius-control-sm\)/);
  assert.match(css, /var\(--font-size-body-sm\)/);
});
