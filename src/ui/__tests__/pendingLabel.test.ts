import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Issue #308. Six modules carried the same three-rule overlay that keeps a
 * submit button from resizing when its label swaps to the pending wording,
 * across 17 call sites.
 *
 * What is left here is the shared module's own contract and the call sites
 * that have to render the pair it needs. The six-consumer list this file
 * used to carry - each entry asserting the composition and the absence of a
 * local copy - is gone: sharedCssRules.ts (Issue #312) catches a rule that
 * restates what it composes, and catches a fresh copy of the sizing rule in
 * any module, which is what a consumer dropping the composition would leave
 * behind.
 */

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** Declarations only: the shared module's comments quote selectors of their own. */
const readCss = (relativePath: string) => read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');

const sharedCss = readCss('../pendingLabel.module.css');

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

void test('every pending swap renders the pair, sized by a copy at least as long as its labels', () => {
  // The overlay only holds the width if the aria-hidden copy carries the
  // longest wording the visible span can take - "保存" -> "保存中…" must be
  // sized by "保存中…", not by "保存". Character count is a proxy: the two
  // labels render in the same font on the same button. Issue #341 replaces
  // that proxy with the button's actual rendered width; until it does, this
  // is the only check that the pattern is used correctly at each call site.
  let checked = 0;

  for (const relativePath of CALL_SITES) {
    const source = read(relativePath);
    // The shared class names stay on the consumers' own CSS modules, so the
    // call sites are unchanged by the sharing.
    assert.doesNotMatch(source, /pendingLabel\.module\.css/, relativePath);

    const wrappers = source.split(/className=\{styles\.stablePendingLabel\}/).slice(1);
    assert.ok(wrappers.length > 0, `${relativePath} has no pending label wrapper`);

    for (const wrapper of wrappers) {
      const region = wrapper.split('</Button>')[0] ?? wrapper;
      const sizing = region.match(
        /aria-hidden="true"\s+className=\{styles\.stablePendingSizing\}>\s*([^<]*?)\s*<\/span>/,
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
