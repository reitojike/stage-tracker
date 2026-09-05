import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Issue #314 moved the week-grid/date-cell/weekday-header/month-nav/
// holiday-notice rules (including .day:hover's own :not(.daySelected)
// scoping, see Issue #77) into src/ui/monthCalendarGrid.module.css, shared
// with the Event Catalog's MonthCalendar.module.css. That module's own rule
// and the wiring that keeps both screens composing it are asserted once, in
// src/ui/__tests__/monthCalendarGrid.test.ts - this file used to carry a
// second copy of both (Issue #312). What stays below is My Calendar's own
// legend vocabulary.

// --- Issue #196: legend vocabulary synced to the row Badge's own labels ---

void test('the participation legend rows reuse participationStatusLabel, never a literal string that could drift from the row Badge', () => {
  const sourcePath = fileURLToPath(new URL('../MyMonthCalendar.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(
    source,
    /variantClass: 'dotFilled',\s*label: participationStatusLabel\('attending'\)/,
  );
  assert.match(
    source,
    /variantClass: 'dotOutline',\s*label: participationStatusLabel\('considering'\)/,
  );
  assert.doesNotMatch(source, /決まっている|検討中/);
});

void test('the Personal Schedule swatch legend vocabulary is untouched by the #196 participation-label sync', () => {
  const sourcePath = fileURLToPath(new URL('../MyMonthCalendar.tsx', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /label: '予定を確保する'/);
  assert.match(source, /label: '確保しない'/);
});
