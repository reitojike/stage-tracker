import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composesRole, readCss as readRepoCss } from './sharedRoleWiring.ts';

/*
 * Issue #316. The Event create form and the Personal Schedule create/edit
 * forms used to carry two independent fixed submit bars, and they had
 * already drifted: only the Schedule one looked at the safe area, and their
 * bottom escape spacing differed by 72px vs 128px. These tests keep the
 * single authority (src/ui/fixedSubmitBar.module.css) from silently
 * splitting back into two.
 *
 * What this file owns: the shared module's own values, the pin to
 * PrimaryNav's actual row height, the required composition wiring, and the
 * markup pairing the contract needs.
 *
 * The per-consumer "and does not restate what it composes" assertions this
 * file used to carry are gone (Issue #312) - a consumer restating a value it
 * already composes is redundant rather than broken, and is left to review.
 * What is not left to review is the composition itself: the wiring below is
 * the only thing standing between a dropped `composes:` line and a submit
 * bar that silently stops being fixed.
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

/*
 * Required composition wiring: which consumer class carries which shared
 * role. Written down because the names differ on purpose (each form keeps
 * its own vocabulary) - there is nothing mechanical to derive it from.
 * Adding a third fixed submit bar means adding a row here; that is the
 * intended cost of the guarantee.
 */
const wiring = [
  ['src/app/catalog/_components/EventWriteForm.module.css', 'fixedSubmit', 'band'],
  ['src/app/catalog/_components/EventWriteForm.module.css', 'fixedSubmitInner', 'inner'],
  ['src/app/catalog/_components/EventWriteForm.module.css', 'fixedForm', 'escape'],
  ['src/app/schedule/_components/ScheduleWriteForm.module.css', 'submitBand', 'band'],
  ['src/app/schedule/_components/ScheduleWriteForm.module.css', 'submitInner', 'inner'],
  ['src/app/schedule/_components/ScheduleWriteForm.module.css', 'form', 'escape'],
] as const;

void test('both write forms compose the shared bar rather than growing their own', () => {
  for (const [relativePath, className, role] of wiring) {
    assert.ok(
      composesRole(readRepoCss(relativePath), className, role, 'fixedSubmitBar.module.css'),
      `${relativePath} .${className} must compose ${role} from fixedSubmitBar.module.css`,
    );
  }
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
