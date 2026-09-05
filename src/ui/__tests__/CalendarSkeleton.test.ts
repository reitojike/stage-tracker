import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Issue #314: the weekday header (previously a third, byte-identical copy
// of MonthCalendar.module.css's / MyMonthCalendar.module.css's own
// .weekdayRow/.weekday) now composes those classes from
// src/ui/monthCalendarGrid.module.css instead of restating them.
const cssPath = fileURLToPath(new URL('../CalendarSkeleton.module.css', import.meta.url));

// Extracts one rule's body ({...} contents) rather than matching the whole
// file with one big anchored regex - same technique as Row.test.ts's own
// composition guard (Issue #271/#315) - so a harmless reformat or an added
// comment inside the rule can never make this test fail on formatting alone.
// Comments are stripped first (not just from the extracted body) so a
// *commented-out* `composes:` line (e.g. left behind after the real
// declaration was removed) can never satisfy the composition assert below.
function cssRule(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = withoutComments.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} rule is missing`);
  return match[1] ?? '';
}

void test('Issue #314: CalendarSkeleton composes the shared weekday-header classes', () => {
  const css = readFileSync(cssPath, 'utf8');
  for (const className of ['weekdayRow', 'weekday']) {
    const rule = cssRule(css, `.${className}`);
    assert.match(
      rule,
      new RegExp(
        'composes:\\s*' +
          className +
          '\\s+from\\s+[\'"][^\'"]*monthCalendarGrid\\.module\\.css[\'"];',
      ),
      `.${className} must compose from monthCalendarGrid.module.css`,
    );
  }
});
