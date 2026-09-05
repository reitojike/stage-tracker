import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Issue #308. Six modules carried the same three-rule overlay that keeps a
 * submit button from resizing when its label swaps to the pending wording,
 * across 17 call sites. These tests keep the single authority
 * (src/ui/pendingLabel.module.css) from splitting back into six copies, and
 * keep the call sites rendering the pair the contract needs.
 *
 * Bounded on purpose: this asserts the pending-label contract and its
 * consumers, not CSS duplication in general. The repository-wide scan is
 * Issue #312's own scope.
 */

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** Declarations only: the shared module's comments quote selectors of their own. */
const readCss = (relativePath: string) => read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');

const sharedCss = readCss('../pendingLabel.module.css');

const CONSUMERS = [
  '../../app/catalog/_components/EventWriteForm.module.css',
  '../../app/catalog/_components/InvitationCard.module.css',
  '../../app/catalog/_components/InviteSheet.module.css',
  '../../app/schedule/_components/ScheduleDetail.module.css',
  '../../app/schedule/_components/ScheduleWriteForm.module.css',
  '../../app/schedule/_components/ShareAddSheet.module.css',
] as const;

/** The 17 call sites listed in Issue #308. */
const CALL_SITES = [
  '../../app/catalog/_components/DeleteEventForm.tsx',
  '../../app/catalog/_components/DeleteOccurrenceForm.tsx',
  '../../app/catalog/_components/EventCancellationForm.tsx',
  '../../app/catalog/_components/EventCreateForm.tsx',
  '../../app/catalog/_components/EventDetailsEditForm.tsx',
  '../../app/catalog/_components/EventRangeEditForm.tsx',
  '../../app/catalog/_components/InvitationCard.tsx',
  '../../app/catalog/_components/InviteSheet.tsx',
  '../../app/catalog/_components/OccurrenceAddForm.tsx',
  '../../app/catalog/_components/OccurrenceCancellationForm.tsx',
  '../../app/catalog/_components/OccurrenceUpdateForm.tsx',
  '../../app/schedule/_components/DeleteEntryForm.tsx',
  '../../app/schedule/_components/LeaveShareForm.tsx',
  '../../app/schedule/_components/RemoveRecipientForm.tsx',
  '../../app/schedule/_components/ScheduleEntryCreateForm.tsx',
  '../../app/schedule/_components/ScheduleEntryEditForm.tsx',
  '../../app/schedule/_components/ShareAddSheet.tsx',
] as const;

/** The declaration body of a top-level rule, which always starts a line. */
const ruleBody = (css: string, selector: string): string => {
  const escaped = selector.replace(/\./g, String.raw`\.`);
  const match = css.match(new RegExp(String.raw`(?:^|\n)${escaped}\s*\{([^}]*)\}`));
  assert.ok(match, `${selector} rule is missing`);
  return match[1] ?? '';
};

const composition = (css: string, selector: string, exported: string) =>
  new RegExp(
    String.raw`(?:^|\n)\.${selector}\s*\{\s*composes:\s*${exported}\s+from\s+['"][^'"]*pendingLabel\.module\.css['"];`,
  ).test(css);

void test('the shared module owns the overlay that holds the button width', () => {
  // The wrapper is a one-cell grid and both labels sit in that cell, so the
  // cell is as wide as the widest of them whichever one is visible.
  assert.match(ruleBody(sharedCss, '.label'), /display:\s*grid;/);
  assert.match(ruleBody(sharedCss, '.label > span'), /grid-area:\s*1\s*\/\s*1;/);

  // visibility, not display: none - the sizing copy has to keep its cell to
  // go on setting the width.
  const sizing = ruleBody(sharedCss, '.sizing');
  assert.match(sizing, /visibility:\s*hidden;/);
  assert.match(sizing, /pointer-events:\s*none;/);
  assert.doesNotMatch(sizing, /display:\s*none/);
});

void test('all six consumers compose the shared overlay instead of restating it', () => {
  for (const relativePath of CONSUMERS) {
    const css = readCss(relativePath);

    assert.ok(composition(css, 'stablePendingLabel', 'label'), relativePath);
    assert.ok(composition(css, 'stablePendingSizing', 'sizing'), relativePath);

    // No local copy of the rule can drift back in beside the composition.
    assert.doesNotMatch(css, /\.stablePendingLabel\s*>\s*span\b/, relativePath);
    assert.doesNotMatch(ruleBody(css, '.stablePendingLabel'), /display:|grid-area:/, relativePath);
    assert.doesNotMatch(
      ruleBody(css, '.stablePendingSizing'),
      /visibility:|pointer-events:/,
      relativePath,
    );
  }
});

void test('the class names stay on the consumers, so the call sites are unchanged', () => {
  for (const relativePath of CALL_SITES) {
    const source = read(relativePath);
    assert.match(source, /className=\{styles\.stablePendingLabel\}/, relativePath);
    assert.match(
      source,
      /aria-hidden="true"\s+className=\{styles\.stablePendingSizing\}/,
      relativePath,
    );
    // The shared names are an implementation detail of the CSS modules.
    assert.doesNotMatch(source, /pendingLabel\.module\.css/, relativePath);
  }
});

void test('every pending swap is sized by a copy at least as long as its labels', () => {
  // The overlay only holds the width if the aria-hidden copy carries the
  // longest wording the visible span can take - "保存" -> "保存中…" must be
  // sized by "保存中…", not by "保存". Character count is the proxy: the two
  // labels render in the same font on the same button.
  let checked = 0;

  for (const relativePath of CALL_SITES) {
    const source = read(relativePath);
    const wrappers = source.split(/className=\{styles\.stablePendingLabel\}/).slice(1);
    assert.ok(wrappers.length > 0, `${relativePath} has no pending label wrapper`);

    for (const wrapper of wrappers) {
      const region = wrapper.split('</Button>')[0] ?? wrapper;
      const sizing = region.match(
        /className=\{styles\.stablePendingSizing\}>\s*([^<]*?)\s*<\/span>/,
      );
      assert.ok(sizing, `${relativePath} has a wrapper without an aria-hidden sizing copy`);

      const sizingText = (sizing[1] ?? '').trim();
      assert.ok(sizingText.length > 0, `${relativePath} sizes its button with an empty copy`);

      const swapped = region.slice((sizing.index ?? 0) + sizing[0].length);
      const labels = [...swapped.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
      assert.ok(labels.length > 0, `${relativePath} has a wrapper with no swapped label`);

      for (const label of labels) {
        // These labels are BMP-only (kana/kanji plus "…"), so UTF-16 length is
        // the character count.
        assert.ok(
          sizingText.length >= label.length,
          `${relativePath}: sizing copy "${sizingText}" is shorter than the label "${label}"`,
        );
      }
      checked += 1;
    }
  }

  // The 17 call sites of Issue #308; InvitationCard renders more than one.
  assert.ok(checked >= CALL_SITES.length, `only ${String(checked)} pending swaps were checked`);
});
