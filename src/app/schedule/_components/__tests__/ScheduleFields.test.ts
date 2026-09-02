import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// ScheduleFields.tsx toggles the all-day/time-bounded field groups with the
// `hidden` attribute, both sharing styles.fields. `[hidden] { display: none }`
// lives in the UA stylesheet, and author-origin rules always beat UA-origin
// rules in the cascade, so without an explicit `.fields[hidden]` override the
// author `.fields { display: flex }` rule wins and the non-selected group
// stays visible (Issue #71). This test guards that override.
const cssPath = fileURLToPath(new URL('../ScheduleWriteForm.module.css', import.meta.url));
const fieldsPath = fileURLToPath(new URL('../ScheduleFields.tsx', import.meta.url));
const sharedInputCssPath = fileURLToPath(
  new URL('../../../../ui/TextInput.module.css', import.meta.url),
);

void test('.fields[hidden] overrides .fields display so a hidden field group collapses', () => {
  const css = readFileSync(cssPath, 'utf8');
  const match = css.match(/\.fields\[hidden\]\s*\{([^}]*)\}/);
  assert.ok(match, '.fields[hidden] rule is missing from ScheduleWriteForm.module.css');
  assert.match(match[1] ?? '', /display:\s*none\s*;/);
});

void test('schedule controls keep the bounded local temporal and blocking vocabulary', () => {
  const css = readFileSync(cssPath, 'utf8');
  const fields = readFileSync(fieldsPath, 'utf8');
  const sharedInputCss = readFileSync(sharedInputCssPath, 'utf8');

  assert.match(fields, /時刻を指定/);
  assert.match(fields, /終日/);
  for (const name of ['startsAt', 'endsAt', 'startsOn', 'endsOn']) {
    assert.match(fields, new RegExp(`name="${name}"`));
  }
  assert.doesNotMatch(fields, /\(blocking\)/);
  assert.match(css, /\.checkboxBox\s*\{[\s\S]*width:\s*18px;[\s\S]*height:\s*18px;/);
  assert.match(css, /\.checkboxBox\s*\{[\s\S]*border-radius:\s*var\(--radius-badge\);/);
  assert.match(css, /\.checkboxRow\s*\{[\s\S]*min-height:\s*44px;/);
  assert.match(
    css,
    /\.pairedFields\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(css, /\.pairedFields\s*\{[\s\S]*gap:\s*var\(--space-xs\);/);
  assert.match(
    css,
    /\.temporalInput\s*\{[\s\S]*padding-inline-start:\s*var\(--space-sm\);[\s\S]*padding-inline-end:\s*var\(--space-2xs\);/,
  );
  const datetimeRule = css.match(/\.temporalInput\[type=['"]datetime-local['"]\]\s*\{([^}]*)\}/);
  assert.ok(datetimeRule, 'datetime-local typography rule is missing');
  assert.match(datetimeRule[1] ?? '', /font-size:\s*var\(--font-size-body-sm\);/);
  assert.doesNotMatch(css, /\.temporalInput\s*\{[^}]*font-size:/);
  assert.doesNotMatch(css, /\.temporalInput\[type=['"]date['"]\]/);
  assert.doesNotMatch(css, /@media/);
  assert.equal((fields.match(/className=\{styles\.temporalInput\}/g) ?? []).length, 4);
  assert.equal((fields.match(/type="datetime-local"/g) ?? []).length, 2);
  assert.equal((fields.match(/type="date"/g) ?? []).length, 2);
  assert.match(sharedInputCss, /\.input\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  assert.match(sharedInputCss, /font-size:\s*var\(--font-size-body\);/);
  assert.match(sharedInputCss, /padding:\s*var\(--space-sm\) var\(--space-md\);/);
  assert.match(css, /\.submitBand\s*\{[\s\S]*position:\s*fixed;/);
});
