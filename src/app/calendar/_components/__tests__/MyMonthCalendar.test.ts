import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Same root cause and fix as MonthCalendar.module.css's own test (Issue
// #77) - see that file's comment for the full explanation of why a bare
// `.day:hover` rule out-specifies `.daySelected`.
const cssPath = fileURLToPath(new URL('../MyMonthCalendar.module.css', import.meta.url));

void test('.day:hover is scoped with :not(.daySelected) so selected fill always wins', () => {
  // Comments (including this file's own explanation, which quotes
  // `.day:hover` in prose) are stripped first so they can't be mistaken for
  // actual selector rules by the checks below.
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(
    css,
    /\.day(?::hover:not\(\.daySelected\)|:not\(\.daySelected\):hover)\s*\{/,
    '.day:hover must be scoped with :not(.daySelected) (either token order)',
  );
  // Catches the bug re-appearing via a selector LIST too (e.g.
  // `.day:hover,\n.day:focus-visible {`), not just a bare `.day:hover {`.
  const unscopedHover = /\.day:hover(?!:not\(\.daySelected\))\b/.exec(css);
  assert.equal(unscopedHover, null, `found an unscoped selector: ${String(unscopedHover?.[0])}`);
});
