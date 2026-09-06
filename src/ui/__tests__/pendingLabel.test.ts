import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composesRole, readCss as readRepoCss } from './sharedRoleWiring.ts';

/*
 * Issue #308. Six modules carried the same three-rule overlay that keeps a
 * submit button from resizing when its label swaps to the pending wording,
 * across 17 call sites.
 *
 * What is left here is the shared module's own contract, the composition
 * wiring, and the call sites that have to render the pair it needs.
 *
 * The "and does not restate the rule locally" half of the old six-consumer
 * list is gone (Issue #312): a consumer restating what it composes is
 * redundant rather than broken, and is left to review. The composition half
 * stays - dropping it silently returns the button to resizing under the
 * user's finger.
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

/*
 * Required composition wiring. All six consumers name the pair the same
 * way, so the wiring is the consumer list plus the two roles - no per-file
 * role mapping to keep in step.
 */
const CONSUMERS = [
  'src/app/catalog/_components/EventWriteForm.module.css',
  'src/app/catalog/_components/InvitationCard.module.css',
  'src/app/catalog/_components/InviteSheet.module.css',
  'src/app/schedule/_components/ScheduleDetail.module.css',
  'src/app/schedule/_components/ScheduleWriteForm.module.css',
  'src/app/schedule/_components/ShareAddSheet.module.css',
] as const;

void test('every consumer composes the shared overlay rather than restating it', () => {
  for (const relativePath of CONSUMERS) {
    const css = readRepoCss(relativePath);
    for (const [className, role] of [
      ['stablePendingLabel', 'label'],
      ['stablePendingSizing', 'sizing'],
    ] as const) {
      assert.ok(
        composesRole(css, className, role, 'pendingLabel.module.css'),
        `${relativePath} .${className} must compose ${role} from pendingLabel.module.css`,
      );
    }
  }
});

/*
 * What is left here is markup shape: every call site renders the pair the
 * overlay is made of, and its sizing copy carries some wording.
 *
 * The comparison that used to follow - sizing copy at least as many
 * *characters* as each swapped label - is gone (Issue #341). It stood in
 * for "the button does not resize", which is a question about rendered
 * width that a character count cannot answer: "招待する" and "送信中…" are
 * both 4 characters and need not paint the same width, so the proxy passed
 * on exactly the pairs where the answer was least obvious.
 *
 * That guarantee moved to test/auth/sharedUiBehavior.test.ts, which drives
 * a real submit through 通常 → 送信中 → 失敗 and measures the button
 * itself: the width and height do not move across the swap, and the
 * aria-hidden copy's painted text is at least as wide as the visible
 * label's. Both halves of what the proxy claimed, measured instead of
 * guessed.
 *
 * The transfer is not one-for-one, and deliberately so. The overlay is one
 * shared CSS module, so the *mechanism* half carries to all 17 call sites
 * from the one that is measured. The *content* half - "this particular
 * call site's copy is the wider wording" - is now measured at one call
 * site rather than approximated at seventeen. Re-checking it at every call
 * site would mean reaching seventeen screens and states in a browser,
 * which Issue #341 rules out ("同じ確認を全 consumer へ複製せず"). A copy
 * that is present but too narrow is left to review, the same call #312
 * made for a consumer restating what it composes.
 */
void test('every pending swap renders the pair the overlay is made of', () => {
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

      // A wrapper whose visible span never swaps has nothing for the
      // sizing copy to hold open, so the pair would be pointless there.
      const swapped = region.slice((sizing.index ?? 0) + sizing[0].length);
      const labels = [...swapped.matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '');
      assert.ok(labels.length > 0, `${relativePath} has a wrapper with no swapped label`);

      checked += 1;
    }
  }

  // The 17 call sites of Issue #308; InvitationCard renders more than one.
  assert.ok(checked >= CALL_SITES.length, `only ${String(checked)} pending swaps were checked`);
});
