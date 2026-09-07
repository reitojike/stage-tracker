/*
 * Shared-role wiring helpers (Issue #312).
 *
 * A shared UI rule is only shared while its consumers actually compose it.
 * Deleting a class, or just its `composes:` line while local declarations
 * stay behind, silently returns that screen to its own presentation - the
 * regression these helpers exist to catch.
 *
 * Which consumer must compose which role is a semantic fact, so it is
 * written down beside each authority rather than inferred: see the wiring
 * lists in fixedSubmitBar/pendingLabel/visuallyHidden/monthCalendarGrid/
 * listRow's own tests. These helpers only answer mechanical
 * questions about a stylesheet's text.
 *
 * Deliberately regex-only. Issue #312 was first implemented with a
 * repository-wide CSS reader (rule aggregation, cascade-final resolution,
 * declaration-signature matching); three review rounds produced precision
 * findings in that layer alone, for a duplicate-selector pattern that
 * occurs nowhere in the tree, while the composition loss above went
 * uncaught. Nothing here needs a declaration model, so there is none.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

/** Reads a repository-relative stylesheet. */
export const readCss = (repoRelativePath: string): string =>
  readFileSync(`${root}/${repoRelativePath}`, 'utf8');

/**
 * Drops comments. These stylesheets explain their own rules in prose that
 * quotes selectors and declarations, so this has to happen before any
 * pattern below runs.
 */
export const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The declaration text of a top-level `selector { ... }` rule, if present. */
export const ruleBody = (css: string, selector: string): string | null => {
  const pattern = new RegExp(`(?:^|\\n)\\s*${escapeForRegExp(selector)}\\s*\\{([^{}]*)\\}`);
  return stripCssComments(css).match(pattern)?.[1] ?? null;
};

/** Class names this stylesheet defines as a bare `.name { ... }` rule. */
export const classesDefinedIn = (css: string): string[] => [
  ...new Set(
    [...stripCssComments(css).matchAll(/(?:^|\n)\s*\.(-?[_a-zA-Z][\w-]*)\s*\{/g)].map(
      (match) => match[1] ?? '',
    ),
  ),
];

/** Every class name this stylesheet mentions in a selector - its exports. */
export const classesMentionedIn = (css: string): ReadonlySet<string> =>
  new Set(
    [...stripCssComments(css).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ''),
  );

/**
 * Splits a selector list on its top-level commas only, so a comma inside
 * `:is(...)` / `:not(...)` / `[attr="a,b"]` stays part of its branch.
 */
export const splitSelectorList = (selector: string): string[] => {
  const branches: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of selector) {
    if (quote !== null) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(' || char === '[') {
      depth += 1;
    } else if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      branches.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  branches.push(current);

  return branches.map((branch) => branch.trim()).filter((branch) => branch !== '');
};

/**
 * Whether `.className` composes `role` from the module whose file name is
 * `authorityFileName`.
 *
 * Anchored three ways, because each is a way a composition has been or
 * could be lost while the stylesheet still reads plausibly:
 *
 * - on the class's own rule body, so a composition elsewhere in the file
 *   cannot stand in for a missing one here;
 * - on comment-stripped text, so a commented-out `composes:` does not count;
 * - on a declaration boundary, so `--composes: band from '...'` - a valid
 *   custom property that composes nothing - is not mistaken for the real
 *   declaration (PR #342 review).
 */
export const composesRole = (
  css: string,
  className: string,
  role: string,
  authorityFileName: string,
): boolean => {
  const body = ruleBody(css, `.${className}`);
  if (body === null) {
    return false;
  }
  const pattern = new RegExp(
    `(?:^|;)\\s*composes\\s*:\\s*[^;]*\\b${escapeForRegExp(role)}\\b[^;]*from\\s+['"][^'"]*` +
      `${escapeForRegExp(authorityFileName)}['"]`,
  );
  return pattern.test(body);
};
