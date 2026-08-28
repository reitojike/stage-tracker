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

// Issue #176: a week overflow summary reusing calendarMonth.ts's existing
// WeekBandLayout.overflowEvents/overflowCount - never a second, presentation
// -side overflow algorithm (Task Contract MUST: "existing overflowEvents /
// overflowCountをreuseし、second overflow algorithmを作らない").

void test('the week overflow summary is gated on week.bandLayout.overflowEvents[0], not a re-derived condition', () => {
  // firstHidden is derived directly from overflowEvents[0] (undefined iff
  // overflowEvents is empty) - equivalent to an overflowEvents.length > 0
  // gate, without re-checking the array's length a second time.
  assert.match(component, /const firstHidden = week\.bandLayout\.overflowEvents\[0\];/);
  assert.match(component, /firstHidden !== undefined/);
});

void test('the summary reads overflowEvents[0] and overflowCount directly - it never recomputes hidden-event count/selection itself', () => {
  assert.match(component, /week\.bandLayout\.overflowEvents\[0\]/);
  assert.match(component, /week\.bandLayout\.overflowCount/);
  // No independent filter/slice of week.bandLayout.segments (the visible
  // lanes) or of a caller-supplied event list for overflow purposes - the
  // only overflow-shaped state this component touches is bandLayout's own.
  assert.doesNotMatch(component, /overflowEvents\s*=\s*(?!week\.bandLayout)/);
});

void test('the hidden Event title is run through bandDisplayTitle, so a canceled hidden Event still carries "（中止）" in the overflow summary', () => {
  assert.match(
    component,
    /bandDisplayTitle\(\s*firstHidden\.eventTitle,\s*firstHidden\.isCanceled,?\s*\)/,
  );
});

void test('the overflow summary links the first hidden Event via catalogEventHref, reusing the existing Catalog navigation context', () => {
  assert.match(component, /catalogEventHref\(\s*firstHidden\.eventId,\s*catalogContext,?\s*\)/);
});

void test('the overflow summary is a single row appended after both band lanes (MAX_BAND_LANES + 2), not a third band lane sharing a lane row', () => {
  assert.match(component, /gridRow:\s*MAX_BAND_LANES \+ 2/);
});

void test('the overflow summary CSS keeps the count prefix intact (nowrap, non-shrinking) while only the variable-length title is ellipsis-truncated', () => {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const labelRule = css.match(/\.weekOverflowLabel\s*\{([\s\S]*?)\}/);
  assert.ok(labelRule, '.weekOverflowLabel rule missing');
  assert.match(labelRule[1] ?? '', /white-space:\s*nowrap/);

  // .weekOverflowLink shares its ellipsis truncation with .band via the
  // .truncatedLine composed class, rather than duplicating the same three
  // properties a second time in this file.
  const linkRule = css.match(/\.weekOverflowLink\s*\{([\s\S]*?)\}/);
  assert.ok(linkRule, '.weekOverflowLink rule missing');
  assert.match(linkRule[1] ?? '', /composes:\s*truncatedLine/);

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
