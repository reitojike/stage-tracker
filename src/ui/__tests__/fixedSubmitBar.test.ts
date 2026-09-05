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
 * Bounded on purpose: this asserts the fixed-submit contract and its two
 * consumers, not CSS duplication in general. The repository-wide scan is
 * Issue #312's own scope.
 */

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** Declarations only: these comments quote selectors and braces of their own. */
const readCss = (relativePath: string) => read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');

const sharedCss = readCss('../fixedSubmitBar.module.css');
const primaryNavCss = readCss('../PrimaryNav.module.css');
const eventCss = readCss('../../app/catalog/_components/EventWriteForm.module.css');
const scheduleCss = readCss('../../app/schedule/_components/ScheduleWriteForm.module.css');

const eventCreateForm = read('../../app/catalog/_components/EventCreateForm.tsx');
const scheduleCreateForm = read('../../app/schedule/_components/ScheduleEntryCreateForm.tsx');
const scheduleEditForm = read('../../app/schedule/_components/ScheduleEntryEditForm.tsx');

/** The declaration body of a top-level rule, which always starts a line. */
const ruleBody = (css: string, selector: string): string => {
  const match = css.match(new RegExp(`(?:^|\\n)\\.${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `.${selector} rule is missing`);
  return match[1] ?? '';
};

const composition = (css: string, selector: string, exported: string) =>
  new RegExp(
    `(?:^|\\n)\\.${selector}\\s*\\{\\s*composes:\\s*${exported}\\s+from\\s+['"][^'"]*fixedSubmitBar\\.module\\.css['"];`,
  ).test(css);

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

void test('both write forms compose the shared bar instead of restating it', () => {
  assert.ok(composition(eventCss, 'fixedSubmit', 'band'));
  assert.ok(composition(eventCss, 'fixedSubmitInner', 'inner'));
  assert.ok(composition(eventCss, 'fixedForm', 'escape'));

  assert.ok(composition(scheduleCss, 'submitBand', 'band'));
  assert.ok(composition(scheduleCss, 'submitInner', 'inner'));
  assert.ok(composition(scheduleCss, 'form', 'escape'));

  for (const css of [eventCss, scheduleCss]) {
    assert.doesNotMatch(css, /position:\s*fixed/);
    assert.doesNotMatch(css, /env\(safe-area-inset-bottom/);
    assert.doesNotMatch(css, /640px/);
  }

  // The two escape classes carry no local padding-bottom of their own, so
  // neither 72px nor 128px can come back as a second authority.
  assert.doesNotMatch(ruleBody(eventCss, 'fixedForm'), /padding-bottom/);
  assert.doesNotMatch(ruleBody(scheduleCss, 'form'), /padding-bottom/);
  assert.doesNotMatch(scheduleCss, /128px/);
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
