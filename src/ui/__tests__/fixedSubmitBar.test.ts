import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Issue #316. The Event create form and the Personal Schedule create/edit
 * forms used to carry two independent fixed submit bars, and they had
 * already drifted: only the Schedule one looked at the safe area, and their
 * bottom escape spacing differed by 72px vs 128px. These tests keep the
 * single authority (src/ui/fixedSubmitBar.module.css) from silently
 * splitting back into two.
 *
 * The two-consumer CSS list this file used to carry (each composing band /
 * inner / escape, and each asserted not to restate them) is gone: Issue
 * #312's sharedCssRules.ts fails any rule that restates what it composes,
 * and any module outside this authority that fixes a bar over the safe area
 * or names PrimaryNav's row height again. What stays is the shared module's
 * own values, the pin to PrimaryNav's actual row height, and the markup
 * pairing the contract needs - none of which a CSS scan can see.
 */

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** Declarations only: these comments quote selectors and braces of their own. */
const readCss = (relativePath: string) => read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');

const sharedCss = readCss('../fixedSubmitBar.module.css');
const primaryNavCss = readCss('../PrimaryNav.module.css');

const eventCreateForm = read('../../app/catalog/_components/EventCreateForm.tsx');
const scheduleCreateForm = read('../../app/schedule/_components/ScheduleEntryCreateForm.tsx');
const scheduleEditForm = read('../../app/schedule/_components/ScheduleEntryEditForm.tsx');

/** The declaration body of a top-level rule, which always starts a line. */
const ruleBody = (css: string, selector: string): string => {
  const match = css.match(new RegExp(`(?:^|\\n)\\.${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `.${selector} rule is missing`);
  return match[1] ?? '';
};

void test('the shared band owns the fixed positioning and the safe-area-aware nav offset', () => {
  const band = ruleBody(sharedCss, 'band');

  assert.match(band, /position:\s*fixed;/);
  assert.match(band, /inset-inline:\s*0;/);
  // Above PrimaryNav's own z-index: 1, so the band draws the shared hairline.
  assert.match(band, /z-index:\s*2;/);
  assert.match(
    band,
    /bottom:\s*calc\(var\(--primary-nav-row-height\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\);/,
  );
  assert.match(band, /border-top:\s*1px solid var\(--color-border\);/);
  assert.match(band, /background-color:\s*var\(--color-canvas\);/);
});

void test('the bar offset stays pinned to the PrimaryNav row height it names', () => {
  const declared = ruleBody(sharedCss, 'band').match(/--primary-nav-row-height:\s*(\d+px);/);
  assert.ok(declared, '--primary-nav-row-height is missing from the shared band');

  const navRow = ruleBody(primaryNavCss, 'link').match(/min-height:\s*(\d+px);/);
  assert.ok(navRow, 'PrimaryNav .link min-height is missing');

  assert.equal(
    declared[1],
    navRow[1],
    'the shared submit bar offset no longer matches PrimaryNav .link { min-height }',
  );
});

void test('the shared inner column and escape spacing are single-valued', () => {
  const inner = ruleBody(sharedCss, 'inner');
  assert.match(inner, /display:\s*flex;/);
  assert.match(inner, /justify-content:\s*flex-end;/);
  assert.match(inner, /max-width:\s*640px;/);
  assert.match(inner, /margin-inline:\s*auto;/);
  assert.match(inner, /padding:\s*var\(--space-compact\) var\(--space-md\);/);

  const escape = ruleBody(sharedCss, 'escape');
  assert.match(escape, /padding-bottom:\s*72px;/);
  // One escape value, not one per consumer.
  assert.equal((sharedCss.match(/padding-bottom:/g) ?? []).length, 1);
  // The safe-area term cancels between the band's offset and PrimaryNav's own
  // padding, so the escape must not add a second one.
  assert.doesNotMatch(escape, /env\(safe-area-inset-bottom/);
});

void test('every fixed submit bar renders the band/inner pair the contract expects', () => {
  const consumers = [
    ['EventCreateForm', eventCreateForm, 'fixedSubmit', 'fixedSubmitInner'],
    ['ScheduleEntryCreateForm', scheduleCreateForm, 'submitBand', 'submitInner'],
    ['ScheduleEntryEditForm', scheduleEditForm, 'submitBand', 'submitInner'],
  ] as const;

  for (const [name, source, band, inner] of consumers) {
    assert.match(
      source,
      new RegExp(
        `<div className=\\{styles\\.${band}\\}>\\s*<div className=\\{styles\\.${inner}\\}>`,
      ),
      `${name} does not render the band/inner pair`,
    );
  }

  // The escape class travels with the band: a fixed bar without it would
  // strand the form's last control behind the bar.
  assert.match(eventCreateForm, /styles\.form, styles\.fixedForm/);
  for (const source of [scheduleCreateForm, scheduleEditForm]) {
    assert.match(source, /className=\{styles\.form\}/);
  }
});
