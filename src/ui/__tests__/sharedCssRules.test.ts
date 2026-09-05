import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORITY_MODULES,
  SIGNATURE_RULES,
  type CssModuleFile,
  detectSharedRuleViolations,
  parseCssRules,
  stripComments,
} from './sharedCssRules.ts';

/*
 * Issue #312. sharedCssRules.ts owns the detector; this file proves it
 * catches what it claims to, leaves legitimate repetition alone, and that
 * the repository is currently clean.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));

/** Every `*.module.css` under the given repository-relative directory. */
const collectCssModules = (directory: string): CssModuleFile[] => {
  const entries = readdirSync(`${root}/${directory}`, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return collectCssModules(path);
    }
    if (!entry.name.endsWith('.module.css')) {
      return [];
    }
    return [{ path, css: readFileSync(`${root}/${path}`, 'utf8') }];
  });
};

const repositoryCssModules = [...collectCssModules('src/app'), ...collectCssModules('src/ui')];

/** The real authority modules, so an example can compose from them. */
const authorityFiles = repositoryCssModules.filter((file) =>
  AUTHORITY_MODULES.some((module) => module.authority === file.path),
);

const violationsFor = (example: CssModuleFile) =>
  detectSharedRuleViolations([...authorityFiles, example]);

// --- the repository itself ---

void test('every *.module.css under src/app and src/ui is discovered without a hand-kept list', () => {
  // The detector's reach is the whole tree, not a registered set of
  // consumers: adding a module (or moving one) needs no list update.
  assert.ok(repositoryCssModules.length > 40, `only ${String(repositoryCssModules.length)} found`);
  for (const module of AUTHORITY_MODULES) {
    assert.ok(
      repositoryCssModules.some((file) => file.path === module.authority),
      `${module.authority} is catalogued as an authority but was not discovered`,
    );
  }
});

void test('no module redeclares a decided shared rule', () => {
  const violations = detectSharedRuleViolations(repositoryCssModules);
  assert.deepEqual(
    violations.map((violation) => violation.message),
    [],
  );
});

// --- the catalog ---

void test('every detected rule names an authority, a reason, and both examples', () => {
  const entries = [
    ...AUTHORITY_MODULES.map((module) => ({
      id: module.id,
      authority: module.authority,
      role: module.role,
      reason: module.reason,
      violationExample: module.violationExample,
      legitimateExample: module.legitimateExample,
    })),
    ...SIGNATURE_RULES.map((signature) => ({
      id: signature.id,
      authority: signature.authority,
      role: signature.role,
      reason: signature.reason,
      violationExample: signature.violationExample,
      legitimateExample: signature.legitimateExample,
    })),
  ];

  const ids = entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'catalog ids must be unique');

  for (const entry of entries) {
    assert.ok(entry.authority.length > 0, `${entry.id} has no authority`);
    assert.ok(entry.role.length > 0, `${entry.id} has no role`);
    assert.ok(entry.reason.length > 20, `${entry.id} has no reason`);
    assert.ok(entry.violationExample.css.length > 0, `${entry.id} has no violation example`);
    assert.ok(entry.legitimateExample.css.length > 0, `${entry.id} has no legitimate example`);
  }
});

void test('every catalogued rule fails on its own violation example, naming file, selector, rule and authority', () => {
  for (const entry of [...AUTHORITY_MODULES, ...SIGNATURE_RULES]) {
    const violations = violationsFor(entry.violationExample).filter(
      (violation) => violation.ruleId === entry.id,
    );
    assert.ok(violations.length > 0, `${entry.id} does not fail on its own violation example`);
    const [violation] = violations;
    assert.ok(violation !== undefined);
    assert.equal(violation.file, entry.violationExample.path);
    assert.ok(violation.selector.length > 0, `${entry.id} reports no selector`);
    assert.ok(violation.declaration.length > 0, `${entry.id} reports no rule`);
    assert.equal(violation.authority, entry.authority);
    for (const fragment of [violation.file, violation.selector, violation.authority]) {
      assert.ok(violation.message.includes(fragment), `${entry.id}: ${violation.message}`);
    }
  }
});

void test('every catalogued rule passes its own legitimate example', () => {
  for (const entry of [...AUTHORITY_MODULES, ...SIGNATURE_RULES]) {
    assert.deepEqual(
      violationsFor(entry.legitimateExample).map((violation) => violation.message),
      [],
      `${entry.id} fails its own legitimate example`,
    );
  }
});

// --- known-bad cases the old per-consumer lists used to cover ---

const knownBad: readonly (readonly [string, string, string])[] = [
  [
    'a brand-new module copying the visually-hidden clip instead of composing it',
    'visually-hidden-clip',
    '.srOnly {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip-path: inset(50%);\n  white-space: nowrap;\n}\n',
  ],
  [
    'a brand-new module copying the legacy clip: rect() technique',
    'visually-hidden-clip',
    '.srOnly {\n  position: absolute;\n  clip: rect(0, 0, 0, 0);\n}\n',
  ],
  [
    'a brand-new module copying the pending label sizing copy',
    'pending-label-sizing-copy',
    '.sizing {\n  visibility: hidden;\n  pointer-events: none;\n}\n',
  ],
  [
    'a brand-new module growing a second fixed submit bar',
    'fixed-submit-bar-safe-area',
    '.band {\n  position: fixed;\n  inset-inline: 0;\n  bottom: calc(60px + env(safe-area-inset-bottom, 0px));\n  z-index: 2;\n}\n',
  ],
  [
    'a second declaration of the PrimaryNav row height',
    'primary-nav-row-height',
    '.band {\n  --primary-nav-row-height: 60px;\n  position: sticky;\n}\n',
  ],
  [
    'a control growing its own 44px tap target instead of composing expand44',
    'tap-target-expand-44',
    ".chip::before {\n  content: '';\n  position: absolute;\n  width: max(100%, 44px);\n  height: max(100%, 44px);\n}\n",
  ],
  [
    'a raw disabled opacity beside cursor: not-allowed',
    'disabled-opacity-token',
    '.choice:disabled {\n  cursor: not-allowed;\n  opacity: 0.6;\n}\n',
  ],
  [
    'a row consumer restating the shared flex sizing (the old migratedRows guard)',
    'row',
    ".headingRow {\n  composes: row from '../../../ui/row.module.css';\n  display: flex;\n  justify-content: space-between;\n}\n",
  ],
  [
    'a row consumer restating the main role sizing (the old migratedMains guard)',
    'row',
    ".text {\n  composes: main from '../../../ui/row.module.css';\n  flex: 1 1 auto;\n  min-width: 0;\n}\n",
  ],
  [
    'an inline badge restating flex-shrink beside the composed role (Issue #311)',
    'row',
    ".canceledBadge {\n  composes: inlineBadge from '../../../ui/row.module.css';\n  flex-shrink: 0;\n}\n",
  ],
  [
    'a write form bringing back its own escape spacing (the 128px of Issue #316)',
    'fixedSubmitBar',
    ".form {\n  composes: escape from '../../../ui/fixedSubmitBar.module.css';\n  padding-bottom: 128px;\n}\n",
  ],
  [
    'a write form restating the bounded inner column width',
    'fixedSubmitBar',
    ".submitInner {\n  composes: inner from '../../../ui/fixedSubmitBar.module.css';\n  max-width: 640px;\n}\n",
  ],
  [
    'a pending label consumer restating the grid overlay',
    'pendingLabel',
    ".stablePendingLabel {\n  composes: label from '../../../ui/pendingLabel.module.css';\n  display: grid;\n}\n",
  ],
  [
    'a calendar consumer restating a shared date-cell declaration',
    'monthCalendarGrid',
    ".day {\n  composes: day from '../../../ui/monthCalendarGrid.module.css';\n  min-height: 44px;\n}\n",
  ],
  [
    'a selected-day list restating the shared heading typography',
    'selectedDayList',
    ".heading {\n  composes: heading from '../../../ui/selectedDayList.module.css';\n  font-size: var(--font-size-title);\n}\n",
  ],
  // A selector may be written more than once, so a rule's meaning is the
  // union of its blocks - splitting a restatement or a signature across two
  // blocks must not slip past either detection path (PR #342 review).
  [
    'a composed role restated in a later rule block',
    'row',
    ".text {\n  composes: main from '../../../ui/row.module.css';\n}\n\n.text {\n  min-width: 0;\n}\n",
  ],
  [
    'a pending-label signature split across rule blocks',
    'pending-label-sizing-copy',
    '.sizing {\n  visibility: hidden;\n}\n\n.sizing {\n  pointer-events: none;\n}\n',
  ],
  [
    'a fixed submit bar signature split across rule blocks',
    'fixed-submit-bar-safe-area',
    '.band {\n  position: fixed;\n}\n\n.band {\n  bottom: calc(60px + env(safe-area-inset-bottom, 0px));\n}\n',
  ],
  // ... including when one of the blocks writes the selector as part of a
  // list, so the branches have to meet before the declarations are read
  // (PR #342 closure review).
  [
    'a signature split across blocks, one of them a selector list',
    'pending-label-sizing-copy',
    '.sizing,\n.other {\n  visibility: hidden;\n}\n\n.sizing {\n  pointer-events: none;\n}\n',
  ],
  [
    'a composed role restated in a later selector list',
    'row',
    ".text {\n  composes: main from '../../../ui/row.module.css';\n}\n\n.text,\n.other {\n  min-width: 0;\n}\n",
  ],
  // Merged blocks are read at their cascade-final value, so an earlier
  // benign value cannot hide the one that actually applies (PR #342
  // closure review).
  [
    'a signature whose property is overwritten into place by a later block',
    'pending-label-sizing-copy',
    '.sizing {\n  visibility: visible;\n}\n\n.sizing {\n  visibility: hidden;\n  pointer-events: none;\n}\n',
  ],
  [
    'a composed role whose owned property is restated by a later block',
    'row',
    ".text {\n  composes: main from '../../../ui/row.module.css';\n  min-width: 10px;\n}\n\n.text {\n  min-width: 0;\n}\n",
  ],
];

void test('the detector catches each known-bad case', () => {
  for (const [name, ruleId, css] of knownBad) {
    const violations = violationsFor({ path: 'src/app/example/_components/New.module.css', css });
    assert.ok(
      violations.some((violation) => violation.ruleId === ruleId),
      `${name} was not caught (${JSON.stringify(violations.map((violation) => violation.message))})`,
    );
  }
});

// --- legitimate patterns that must never fail ---

const knownGood: readonly (readonly [string, string])[] = [
  [
    'the vertical flex stack #319 decided not to share',
    '.section {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-md);\n}\n\n.list {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-sm);\n}\n',
  ],
  [
    'the list reset #319 decided to keep site-local',
    '.items {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n}\n',
  ],
  [
    'the sub-line token pair #319 decided not to share',
    '.time {\n  color: var(--color-text-secondary);\n  font-size: var(--font-size-body-sm);\n  margin: 0;\n}\n',
  ],
  [
    'a focus ring forwarded to a visible proxy (docs/ux-ui.md, #319)',
    '.input:focus-visible + .box {\n  outline: var(--focus-ring-width) solid var(--color-focus-ring);\n  outline-offset: var(--focus-ring-offset);\n}\n',
  ],
  [
    'an independent space-between layout that is not the row role',
    '.controls {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: var(--space-sm);\n}\n',
  ],
  [
    'an unrelated non-shrinking flex child',
    '.dateColumn {\n  flex-shrink: 0;\n  width: 64px;\n}\n',
  ],
  [
    'a decorative overlay that only disables pointer events',
    '.scrim {\n  pointer-events: none;\n  opacity: 0.5;\n}\n',
  ],
  [
    "Sheet's own fixed dialog, with no safe-area term",
    '.backdrop {\n  position: fixed;\n  inset: 0;\n}\n',
  ],
  [
    "PrimaryNav's own safe-area padding, with no fixed positioning",
    '.nav {\n  position: sticky;\n  bottom: 0;\n  padding-bottom: env(safe-area-inset-bottom, 0px);\n}\n',
  ],
  [
    'an untokenised control size that docs/ux-ui.md leaves as a raw px value',
    '.icon {\n  min-width: 40px;\n  min-height: 40px;\n}\n',
  ],
  [
    'a loading placeholder dimming itself without being a disabled control',
    '.placeholder {\n  opacity: 0.6;\n}\n',
  ],
  [
    'a screen-local alignment exception on a composed row (docs/ux-ui.md)',
    ".titleRow {\n  composes: row from '../../../ui/row.module.css';\n  align-items: flex-start;\n  gap: 6px;\n}\n",
  ],
  [
    'a composed role extended with declarations the role does not own',
    ".itemLink {\n  composes: row from '../../../ui/row.module.css';\n  padding-block: var(--space-card-block);\n  text-decoration: none;\n  color: inherit;\n}\n",
  ],
  [
    'a class named like a shared role in a file that composes nothing from it',
    '.band {\n  display: block;\n}\n\n.main {\n  flex: 1 1 auto;\n}\n',
  ],
  [
    // HomeDeadlineList's own `.row` is a horizontal-scroll card list, not
    // the shared row role, in a file that does compose that role elsewhere.
    'a class that shares a shared role’s name while meaning something else',
    ".row {\n  display: flex;\n  overflow-x: auto;\n  list-style: none;\n}\n\n.deadline {\n  composes: row from '../../../ui/row.module.css';\n  gap: var(--space-2xs);\n}\n",
  ],
  [
    // CalendarSkeleton composes the weekday header from the shared grid but
    // deliberately keeps its own header/week/day placeholders (Issue #314).
    'a placeholder that mirrors a shared grid on purpose while composing part of it',
    ".weekdayRow {\n  composes: weekdayRow from '../../../ui/monthCalendarGrid.module.css';\n}\n\n.week {\n  display: grid;\n  grid-template-columns: repeat(7, minmax(0, 1fr));\n  gap: var(--space-2xs);\n}\n\n.day {\n  display: block;\n  min-height: 44px;\n  background-color: var(--color-surface-subtle);\n}\n",
  ],
  [
    'a keyframe step that happens to look like a shared signature',
    '@keyframes fade {\n  from {\n    visibility: hidden;\n    pointer-events: none;\n  }\n}\n',
  ],
  [
    // Blocks are merged per at-rule context, so a conditional override is
    // not read as more of the base rule.
    'halves of a signature separated by a media query',
    '.band {\n  position: fixed;\n}\n\n@media (min-width: 600px) {\n  .other {\n    bottom: env(safe-area-inset-bottom, 0px);\n  }\n}\n',
  ],
  [
    // Splitting selector lists is top-level only: a comma inside :not()/:is()
    // belongs to its branch and must not split it.
    'a functional pseudo-class whose argument contains a comma',
    '.day:not(.daySelected, .dayOutside):hover {\n  background-color: var(--color-surface-subtle);\n}\n',
  ],
  [
    'two different classes that merely share a declaration block',
    '.alpha,\n.beta {\n  visibility: hidden;\n}\n',
  ],
  [
    // The mirror of the cascade-final known-bad cases: a value the cascade
    // has already replaced is not judged, in either direction.
    'a signature value overridden away by a later block',
    '.sizing {\n  visibility: hidden;\n  pointer-events: none;\n}\n\n.sizing {\n  visibility: visible;\n}\n',
  ],
  [
    // The exact restatement in the first block is no longer what applies,
    // so what is judged is the screen-local exception that replaced it.
    'a restated value replaced by a documented screen-local exception',
    ".titleRow {\n  composes: row from '../../../ui/row.module.css';\n  align-items: center;\n}\n\n.titleRow {\n  align-items: flex-start;\n}\n",
  ],
];

void test('legitimate repetition never fails', () => {
  for (const [name, css] of knownGood) {
    const violations = violationsFor({ path: 'src/app/example/_components/New.module.css', css });
    assert.deepEqual(
      violations.map((violation) => violation.message),
      [],
      name,
    );
  }
});

// --- the minimal parsing the detector depends on ---

void test('comments, strings and selector lists are not mistaken for declarations', () => {
  const css = [
    '/* .fake { clip-path: inset(50%); } */',
    '.a,',
    '.b {',
    "  content: '/* not a comment */';",
    '  color: red;',
    '}',
    '@media (min-width: 600px) {',
    '  .c {',
    '    color: blue;',
    '  }',
    '}',
  ].join('\n');

  assert.doesNotMatch(stripComments(css), /clip-path/);
  const rules = parseCssRules(css);
  assert.deepEqual(
    rules.map((rule) => rule.selector),
    ['.a, .b', '.c'],
  );
  assert.deepEqual(
    rules[0]?.declarations.map((entry) => entry.property),
    ['content', 'color'],
  );
});
