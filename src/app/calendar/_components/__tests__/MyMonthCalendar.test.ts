import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Same root cause and fix as MonthCalendar.module.css's own test (Issue
// #77) - see that file's comment for the full explanation of why a bare
// `.day:hover` rule out-specifies `.daySelected`.
const cssPath = fileURLToPath(new URL('../MyMonthCalendar.module.css', import.meta.url));

void test('.day:hover is scoped with :not(.daySelected) so selected fill always wins', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.match(css, /\.day:hover:not\(\.daySelected\)\s*\{/);
  assert.doesNotMatch(css, /\.day:hover\s*\{/);
});
