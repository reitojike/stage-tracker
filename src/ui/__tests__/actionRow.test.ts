import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Issue #310. `EventWriteForm.module.css` held this equal-width row rule
 * twice (`.dangerActions` / `.sheetLifecycleActions`), identical apart from
 * `flex-wrap`. This file owns the shared module's own layout contract.
 *
 * No consumer wiring list here, by the same reasoning Row.test.ts (Issue
 * #312) already gives for `.row`/`.main`/`.aside`/`.inlineBadge`: this is a
 * small generic flex declaration whose loss degrades a layout (unequal
 * button widths) rather than breaking a control, with exactly two
 * consumers, both in the one file this Issue already touches. Visual
 * verification at representative viewports plus ordinary review is
 * proportionate here; a permanent composition-loss guard is not. If a
 * composition loss is ever actually observed, that evidence - not the
 * possibility - is what should bring bounded wiring back.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const css = readFileSync(`${root}/src/ui/actionRow.module.css`, 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^{}]*)\\}`));
  assert.ok(match, `${selector} rule is missing from src/ui/actionRow.module.css`);
  return match[1] ?? '';
}

void test('Issue #310: the shared equal-width row owns gap and flex sizing', () => {
  assert.match(cssRule('.equal'), /display:\s*flex;/);
  assert.match(cssRule('.equal'), /gap:\s*var\(--space-sm\);/);
  // Deliberately no flex-wrap and no font-size here - flex-wrap and each
  // action's typography stay with the consumer (docs/ux-ui.md "action
  // area").
  assert.doesNotMatch(cssRule('.equal'), /flex-wrap/);
  assert.doesNotMatch(cssRule('.equal'), /font-size/);
});

void test('Issue #310: equal-width sizing covers both a bare button and a form child', () => {
  const childSizing = cssRule('.equal > form,\n.equal > button');
  assert.match(childSizing, /flex:\s*1 1 0;/);
  assert.match(childSizing, /min-width:\s*0;/);
});

void test('Issue #310: a composed form child button fills its column', () => {
  assert.match(cssRule('.equal > form > button'), /width:\s*100%;/);
});
