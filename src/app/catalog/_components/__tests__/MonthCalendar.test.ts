import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// `.day:hover` (a class + a pseudo-class) is more specific than the
// single-class `.daySelected`, so a bare `.day:hover { background-color }`
// rule wins the cascade over .daySelected's accent fill whenever both match
// - which touch browsers make sticky after a tap, leaving the selected cell
// with a near-white fill and near-white text until a different cell is
// tapped (Issue #77). This test guards the :not(.daySelected) scoping that
// removes the conflict regardless of hover stickiness.
const cssPath = fileURLToPath(new URL('../MonthCalendar.module.css', import.meta.url));

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
