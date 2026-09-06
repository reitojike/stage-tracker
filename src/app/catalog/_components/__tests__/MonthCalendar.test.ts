import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so the Issue #176 tests below guard the
// component's source/CSS the same way FilterSheet.test.ts does: reading the
// files as text rather than rendering them.
const componentPath = fileURLToPath(new URL('../MonthCalendar.tsx', import.meta.url));
const component = readFileSync(componentPath, 'utf8');

// Issue #314 moved the week-grid/date-cell/weekday-header/month-nav/
// holiday-notice presentation into src/ui/monthCalendarGrid.module.css,
// shared with My Calendar's MyMonthCalendar.module.css. That module's own
// rule (the :not(.daySelected) hover scoping of Issue #77) and the wiring
// that keeps both screens composing it are asserted once, in
// src/ui/__tests__/monthCalendarGrid.test.ts - this file used to carry a
// second copy of both (Issue #312). What stays below is the Event Catalog's
// own week-overflow presentation, which reads this file's own cssPath.
const cssPath = fileURLToPath(new URL('../MonthCalendar.module.css', import.meta.url));

// Issue #176: a week overflow summary reusing calendarMonth.ts's existing
// WeekBandLayout.overflowEvents/overflowCount - never a second, presentation
// -side overflow algorithm (Task Contract MUST: "existing overflowEvents /
// overflowCountをreuseし、second overflow algorithmを作らない").
//
// Issue #181 extends the summary to name every hidden Event (not just the
// first), still off the same overflowEvents/overflowCount authority, with
// "how many titles actually fit" left entirely to CSS single-line
// ellipsis - never a JS text/viewport-width measurement or an independent
// slice of overflowEvents.

void test('the week overflow summary is gated on week.bandLayout.overflowEvents, not a re-derived condition', () => {
  assert.match(component, /const overflowEvents = week\.bandLayout\.overflowEvents;/);
  assert.match(component, /overflowEvents\.length > 0/);
});

void test('the summary reads overflowEvents and overflowCount directly - it never recomputes hidden-event count/selection itself', () => {
  assert.match(component, /const overflowEvents = week\.bandLayout\.overflowEvents;/);
  assert.match(component, /week\.bandLayout\.overflowCount/);
  // No independent filter/slice of week.bandLayout.segments (the visible
  // lanes) or of a caller-supplied event list for overflow purposes - the
  // only overflow-shaped state this component touches is bandLayout's own,
  // and it is read once (not re-sliced/re-filtered) before being mapped
  // straight into presentation. `overflowEvents =` appears exactly once in
  // the whole component (the single `const overflowEvents = ...` read).
  const assignments = component.match(/overflowEvents\s*=[^=]/g) ?? [];
  assert.equal(
    assignments.length,
    1,
    `expected exactly one overflowEvents assignment, found: ${JSON.stringify(assignments)}`,
  );
  assert.match(component, /const overflowEvents = week\.bandLayout\.overflowEvents;/);
  assert.doesNotMatch(component, /overflowEvents\.(?:filter|slice)\(/);
});

void test('no JS text/viewport-width measurement is introduced for the overflow summary', () => {
  // Task Contract MUST: bounding to "what fits on one line" is CSS-only
  // (single-line ellipsis) - this component must never measure text width,
  // viewport width, or an element's rendered size to decide how many hidden
  // titles to include.
  assert.doesNotMatch(component, /getBoundingClientRect|offsetWidth|scrollWidth|innerWidth/);
});

void test('every hidden Event title is run through bandDisplayTitle, so a canceled hidden Event still carries "（中止）" in the overflow summary', () => {
  assert.match(component, /bandDisplayTitle\(\s*hidden\.eventTitle,\s*hidden\.isCanceled,?\s*\)/);
});

void test('each hidden Event links via catalogEventHref, reusing the existing Catalog navigation context', () => {
  assert.match(component, /catalogEventHref\(\s*hidden\.eventId,\s*catalogContext,?\s*\)/);
});

void test('hidden titles are separated by "、" and rendered in overflowEvents order (index-keyed insertion, not a re-sort)', () => {
  assert.match(component, /overflowEvents\.map\(\(hidden, index\) => \{/);
  assert.match(component, /index > 0 \? '、' : null/);
});

void test('the overflow summary is a single row appended after both band lanes (MAX_BAND_LANES + 2), not a third band lane sharing a lane row', () => {
  assert.match(component, /gridRow:\s*MAX_BAND_LANES \+ 2/);
});

void test('the overflow summary CSS keeps the count prefix intact (nowrap, non-shrinking) while only the combined title line is ellipsis-truncated', () => {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const labelRule = css.match(/\.weekOverflowLabel\s*\{([\s\S]*?)\}/);
  assert.ok(labelRule, '.weekOverflowLabel rule missing');
  assert.match(labelRule[1] ?? '', /white-space:\s*nowrap/);

  // .weekOverflowTitles (the wrapper around every hidden-title Link, not
  // each Link individually) shares its ellipsis truncation with .band via
  // the .truncatedLine composed class, rather than duplicating the same
  // three properties a second time in this file. Truncating the wrapper as
  // a whole (not each Link) is what lets the ellipsis fall wherever the
  // combined text stops fitting, instead of clipping every title
  // independently.
  const titlesRule = css.match(/\.weekOverflowTitles\s*\{([\s\S]*?)\}/);
  assert.ok(titlesRule, '.weekOverflowTitles rule missing');
  assert.match(titlesRule[1] ?? '', /composes:\s*truncatedLine/);

  const truncatedLineRule = css.match(/\.truncatedLine\s*\{([\s\S]*?)\}/);
  assert.ok(truncatedLineRule, '.truncatedLine rule missing');
  assert.match(truncatedLineRule[1] ?? '', /text-overflow:\s*ellipsis/);
  assert.match(truncatedLineRule[1] ?? '', /white-space:\s*nowrap/);
  assert.match(truncatedLineRule[1] ?? '', /overflow:\s*hidden/);

  // .band (the visible-lane truncation) composes the same shared class,
  // so both truncation sites can never drift apart.
  const bandRule = css.match(/\.band\s*\{([\s\S]*?)\}/);
  assert.ok(bandRule, '.band rule missing');
  assert.match(bandRule[1] ?? '', /composes:\s*truncatedLine/);
});

void test('the week overflow row itself does not grow with the number of hidden titles (single fixed grid row, no per-title row/height rule)', () => {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const overflowRule = css.match(/\.weekOverflow\s*\{([\s\S]*?)\}/);
  assert.ok(overflowRule, '.weekOverflow rule missing');
  // `line-height` is fine (it does not grow the row with content); a literal
  // `height:`/`min-height:` declaration is not.
  assert.doesNotMatch(overflowRule[1] ?? '', /min-height:/);
  assert.doesNotMatch(overflowRule[1] ?? '', /(?<!line-)height:/);
  // Only one occurrence of "gridRow: MAX_BAND_LANES + 2" in the component -
  // the overflow summary is a single row, not one row per hidden title.
  const gridRowMatches = component.match(/gridRow:\s*MAX_BAND_LANES \+ 2/g) ?? [];
  assert.equal(gridRowMatches.length, 1);
});
