import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tokens = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
const dayRoleText = readFileSync(
  fileURLToPath(new URL('../DayRoleText.tsx', import.meta.url)),
  'utf8',
);
const badgeCss = readFileSync(
  fileURLToPath(new URL('../Badge.module.css', import.meta.url)),
  'utf8',
);

function tokenValue(name: string): string {
  const line = tokens
    .split(String.fromCharCode(10))
    .find((candidate) => candidate.trim().startsWith(name + ':'));
  assert.ok(line, name + ' is missing from tokens.css');
  const value = line
    .trim()
    .slice(name.length + 1)
    .trim();
  return value.endsWith(';') ? value.slice(0, -1) : value;
}

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(selector + ' {');
  assert.notEqual(start, -1, selector + ' rule is missing');
  const bodyStart = start + selector.length + 2;
  const bodyEnd = css.indexOf('}', bodyStart);
  assert.notEqual(bodyEnd, -1, selector + ' rule is unterminated');
  return css.slice(bodyStart, bodyEnd);
}

void test('Issue #222 pins calendar Sunday and holiday to semantic danger without moving the palette', () => {
  assert.equal(tokenValue('--color-calendar-sunday'), 'var(--color-danger)');
  assert.equal(tokenValue('--color-calendar-holiday'), 'var(--color-danger)');
  assert.equal(tokenValue('--color-status-danger-500'), '#b3413a');
  assert.equal(tokenValue('--color-danger'), '#a13b2e');
  assert.equal(tokenValue('--color-danger-on'), '#f7f5f1');
  assert.equal(tokenValue('--color-calendar-saturday'), 'var(--color-accent)');
});

void test('Issue #222 preserves DayRoleText and deadline Badge role mappings', () => {
  assert.ok(dayRoleText.includes('const ROLE_COLOR'), 'ROLE_COLOR is missing from DayRoleText.tsx');
  assert.ok(dayRoleText.includes("holiday: 'var(--color-danger)'"));
  assert.ok(dayRoleText.includes("sunday: 'var(--color-danger)'"));
  assert.ok(dayRoleText.includes("saturday: 'var(--color-accent)'"));

  const deadline = cssRule(badgeCss, '.deadline');
  assert.ok(deadline.includes('background-color: var(--color-danger);'));
  assert.ok(deadline.includes('color: var(--color-danger-on);'));
});
