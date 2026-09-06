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
 * selectedDayList's own tests. These helpers only answer mechanical
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
 * Whether `.className` composes `role` from the module whose file name is
 * `authorityFileName`.
 *
 * Anchored on the class's own rule body, so a composition elsewhere in the
 * file cannot stand in for a missing one here, and a commented-out
 * `composes:` cannot satisfy it.
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
    `composes:\\s*[^;]*\\b${escapeForRegExp(role)}\\b[^;]*from\\s+['"][^'"]*${escapeForRegExp(
      authorityFileName,
    )}['"]`,
  );
  return pattern.test(body);
};
