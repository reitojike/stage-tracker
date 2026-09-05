import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Issue #314: the weekday header (previously a third, byte-identical copy
// of MonthCalendar.module.css's / MyMonthCalendar.module.css's own
// .weekdayRow/.weekday) now composes those classes from
// src/ui/monthCalendarGrid.module.css instead of restating them.
const cssPath = fileURLToPath(new URL('../CalendarSkeleton.module.css', import.meta.url));

void test('Issue #314: CalendarSkeleton composes the shared weekday-header classes', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.match(
    css,
    /\.weekdayRow\s*\{\s*composes:\s*weekdayRow\s+from\s+['"][^'"]*monthCalendarGrid\.module\.css['"];/,
  );
  const weekdayRule = css.match(/\.weekday\s*\{([\s\S]*?)\}/);
  assert.ok(weekdayRule, '.weekday rule missing');
  assert.match(
    weekdayRule[1] ?? '',
    /composes:\s*weekday\s+from\s+['"][^'"]*monthCalendarGrid\.module\.css['"];/,
  );
});
