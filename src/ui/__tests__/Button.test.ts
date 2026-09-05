import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the component's markup/CSS
// contract by reading the source rather than rendering it - same approach as
// Badge.test.ts / TriStateCheckbox.test.ts.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relativePath: string) => readFileSync(`${root}/${relativePath}`, 'utf8');
const css = read('src/ui/Button.module.css');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Anchored on the end of the preceding rule/comment (`}` or `*/`) or the
  // start of the file, so `.small` resolves to its own rule rather than to
  // the grouped `.secondary,\n.small { ... }` chrome rule above it.
  const match = css.match(new RegExp(`(?:^|[}/])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${selector} rule is missing from Button.module.css`);
  return match[1] ?? '';
}

void test('Issue #270: the shared Button keeps its label on one line', () => {
  assert.match(cssRule('.button'), /white-space:\s*nowrap;/);
});

void test('Issue #270: LinkButton inherits the same contract from Button.module.css', () => {
  // LinkButton renders an <a> carrying styles.button from this same
  // stylesheet, so the nowrap contract must not be restated for it.
  const linkButton = read('src/ui/LinkButton.tsx');
  assert.match(linkButton, /from '\.\/Button\.module\.css'/);
  assert.match(linkButton, /styles\.button/);
});

void test('Issue #270: the shared label span carries no nowrap policy of its own', () => {
  // The nowrap policy is the Button's, inherited by the label span stacked
  // inside it (src/ui/pendingLabel.module.css). Issue #312 removed the
  // six-consumer list that asserted the same absence file by file: those
  // consumers' own `.stablePendingButton { white-space: nowrap }` was
  // deleted by #270 and the class no longer exists anywhere, while a local
  // copy of the overlay itself is now caught repository-wide by
  // sharedCssRules.ts.
  const sharedLabelSpan = read('src/ui/pendingLabel.module.css').match(
    /\.label\s*>\s*span\s*\{([^}]*)\}/,
  );
  assert.ok(sharedLabelSpan, 'src/ui/pendingLabel.module.css lost its .label > span rule');
  assert.doesNotMatch(sharedLabelSpan[1] ?? '', /white-space/);
});

void test('Issue #270 regression guard: tap target, fill heights and icon sizing are untouched', () => {
  const base = cssRule('.button');
  assert.match(base, /composes:\s*expand44 from '\.\/tapTarget\.module\.css';/);
  assert.match(base, /min-height:\s*35px;/);
  assert.match(base, /touch-action:\s*manipulation;/);

  assert.match(cssRule('.small'), /min-height:\s*31px;/);
  assert.match(cssRule('.quiet'), /min-height:\s*27px;/);

  const icon = cssRule('.icon');
  assert.match(icon, /min-width:\s*40px;/);
  assert.match(icon, /min-height:\s*40px;/);
});

void test('Issue #270 regression guard: the variant API is unchanged', () => {
  assert.match(
    read('src/ui/Button.tsx'),
    /export type ButtonVariant =\s*'primary'\s*\|\s*'secondary'\s*\|\s*'small'\s*\|\s*'quiet'\s*\|\s*'icon'\s*\|\s*'danger';/,
  );
});
