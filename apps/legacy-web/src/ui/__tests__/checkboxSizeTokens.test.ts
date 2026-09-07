import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ruleBody } from './sharedRoleWiring.ts';

/*
 * Issue #358. `TriStateCheckbox`'s 3-state box/glyph and ScheduleWriteForm's
 * screen-local 2-state checkbox render the same 18px box / 12px check-glyph
 * presentation value, but are not one component API (see docs/ux-ui.md
 * "component API sharingとpresentation / semantic value sharingは別軸") -
 * each keeps its own DOM, selector and checked-state implementation.
 *
 * Before this Issue, that one guarantee ("the box is 18px") was asserted
 * twice, once per consumer's own test, as the two components' local raw
 * literals happened to agree. This file is the single place that owns the
 * *value* (--size-checkbox-box / --size-checkbox-glyph in tokens.css); each
 * consumer's own test only has to prove it is wired to that value, not that
 * the value itself is correct - same split as src/ui/__tests__/
 * sharedRoleWiring.ts's composes-wiring tests versus each authority's own
 * declaration test.
 */

const tokensPath = fileURLToPath(new URL('../tokens.css', import.meta.url));
const triStateCssPath = fileURLToPath(new URL('../TriStateCheckbox.module.css', import.meta.url));
const scheduleCssPath = fileURLToPath(
  new URL('../../app/schedule/_components/ScheduleWriteForm.module.css', import.meta.url),
);

const tokens = readFileSync(tokensPath, 'utf8');
const triStateCss = readFileSync(triStateCssPath, 'utf8');
const scheduleCss = readFileSync(scheduleCssPath, 'utf8');

function tokenValue(css: string, name: string): string {
  const line = css.split('\n').find((candidate) => candidate.trim().startsWith(`${name}:`));
  assert.ok(line, `${name} is missing from tokens.css`);
  const value = line
    .trim()
    .slice(name.length + 1)
    .trim();
  return value.endsWith(';') ? value.slice(0, -1) : value;
}

void test('the checkbox box/glyph presentation value has a single numeric authority in tokens.css', () => {
  assert.equal(tokenValue(tokens, '--size-checkbox-box'), '18px');
  assert.equal(tokenValue(tokens, '--size-checkbox-glyph'), '12px');
});

void test('TriStateCheckbox wires its box and check glyph to the shared size tokens, not a local literal', () => {
  const box = ruleBody(triStateCss, '.box');
  assert.ok(box, '.box rule is missing from TriStateCheckbox.module.css');
  assert.match(box, /width:\s*var\(--size-checkbox-box\)\s*;/);
  assert.match(box, /height:\s*var\(--size-checkbox-box\)\s*;/);
  assert.doesNotMatch(box, /width:\s*\d+px/);

  const check = ruleBody(triStateCss, '.check');
  assert.ok(check, '.check rule is missing from TriStateCheckbox.module.css');
  assert.match(check, /width:\s*var\(--size-checkbox-glyph\)\s*;/);
  assert.match(check, /height:\s*var\(--size-checkbox-glyph\)\s*;/);
  assert.doesNotMatch(check, /width:\s*\d+px/);
});

void test('ScheduleWriteForm wires its checkbox box and check glyph to the shared size tokens, not a local literal', () => {
  const box = ruleBody(scheduleCss, '.checkboxBox');
  assert.ok(box, '.checkboxBox rule is missing from ScheduleWriteForm.module.css');
  assert.match(box, /width:\s*var\(--size-checkbox-box\)\s*;/);
  assert.match(box, /height:\s*var\(--size-checkbox-box\)\s*;/);
  assert.doesNotMatch(box, /width:\s*\d+px/);

  const svg = ruleBody(scheduleCss, '.checkboxBox svg');
  assert.ok(svg, '.checkboxBox svg rule is missing from ScheduleWriteForm.module.css');
  assert.match(svg, /width:\s*var\(--size-checkbox-glyph\)\s*;/);
  assert.match(svg, /height:\s*var\(--size-checkbox-glyph\)\s*;/);
  assert.doesNotMatch(svg, /width:\s*\d+px/);
});
