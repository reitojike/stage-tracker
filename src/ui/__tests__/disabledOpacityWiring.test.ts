import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCss, ruleBody } from './sharedRoleWiring.ts';

/*
 * Issue #361. `--opacity-disabled` is the single value authority for what a
 * disabled control looks like (Issue #324, docs/ux-ui.md "Common states").
 * This is a component API sharingとpresentation / semantic value sharing
 * separation (Issue #358): the token is shared, but each site keeps its own
 * selector shape and DOM structure - a `:disabled` pseudo-class here, a
 * `:has(...)` ancestor selector there.
 *
 * docs/ux-ui.md names five current sites for this contract: Button,
 * TextInput, TriStateCheckbox, ParticipationSheet, ScheduleWriteForm. This
 * file guards only that docs-specified 5-site contract, the same way
 * checkboxSizeTokens.test.ts guards a docs-specified pair of consumers for
 * --size-checkbox-box/--size-checkbox-glyph.
 *
 * This is deliberately not a repository-wide census: it does not assert
 * there are exactly five disabled consumers in the codebase, and it will
 * not fail if a sixth site adopts --opacity-disabled independently later.
 * It also does not unify the five selector shapes into one shared class -
 * that stays out of scope per docs/ux-ui.md's disabled example under
 * "component API sharingとpresentation / semantic value sharingは別軸".
 */

const SITES = [
  ['src/ui/Button.module.css', '.button:disabled'],
  ['src/ui/TextInput.module.css', '.input:disabled'],
  ['src/ui/TriStateCheckbox.module.css', '.row:has(.input:disabled)'],
  ['src/app/catalog/_components/ParticipationSheet.module.css', '.choice:disabled'],
  [
    'src/app/schedule/_components/ScheduleWriteForm.module.css',
    '.checkboxRow:has(.controlInput:disabled),\n.segment:has(.controlInput:disabled)',
  ],
] as const;

void test('the docs-specified 5 disabled sites wire opacity to --opacity-disabled', () => {
  for (const [relativePath, selector] of SITES) {
    const css = readCss(relativePath);
    const body = ruleBody(css, selector);
    assert.ok(body, `${relativePath}: selector "${selector}" is missing`);
    assert.match(
      body,
      /opacity:\s*var\(--opacity-disabled\)\s*;/,
      `${relativePath}: "${selector}" must reference var(--opacity-disabled)`,
    );
    const opacityDeclarations = [...body.matchAll(/opacity:\s*([^;]+);/g)].map((match) =>
      match[1].trim(),
    );
    for (const value of opacityDeclarations) {
      assert.equal(
        value,
        'var(--opacity-disabled)',
        `${relativePath}: "${selector}" must not override opacity with a raw literal ("${value}")`,
      );
    }
  }
});

void test('--opacity-disabled has a single numeric authority in tokens.css', () => {
  const tokens = readCss('src/ui/tokens.css');
  const line = tokens
    .split('\n')
    .find((candidate) => candidate.trim().startsWith('--opacity-disabled:'));
  assert.ok(line, '--opacity-disabled is missing from tokens.css');
  assert.match(line, /--opacity-disabled:\s*0\.6\s*;/);
});
