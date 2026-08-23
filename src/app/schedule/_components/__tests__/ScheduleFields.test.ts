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

void test('.fields[hidden] overrides .fields display so a hidden field group collapses', () => {
  const css = readFileSync(cssPath, 'utf8');
  const match = css.match(/\.fields\[hidden\]\s*\{([^}]*)\}/);
  assert.ok(match, '.fields[hidden] rule is missing from ScheduleWriteForm.module.css');
  assert.match(match[1] ?? '', /display:\s*none\s*;/);
});
