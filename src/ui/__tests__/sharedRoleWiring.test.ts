import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classesDefinedIn, classesMentionedIn, composesRole } from './sharedRoleWiring.ts';

/*
 * Issue #312. The wiring lists in each authority's own test are only worth
 * having if `composesRole` actually fails on the ways a composition gets
 * lost. The one that matters most is not an empty class - it is a rule that
 * keeps its local declarations while the `composes:` line disappears, which
 * leaves the stylesheet looking perfectly reasonable.
 */

const AUTHORITY = 'fixedSubmitBar.module.css';

void test('a rule that loses only its composes, keeping local declarations, is not wired', () => {
  const wired =
    ".fixedSubmit {\n  composes: band from '../../../ui/fixedSubmitBar.module.css';\n  z-index: 3;\n}\n";
  const lost = '.fixedSubmit {\n  z-index: 3;\n}\n';

  assert.equal(composesRole(wired, 'fixedSubmit', 'band', AUTHORITY), true);
  assert.equal(composesRole(lost, 'fixedSubmit', 'band', AUTHORITY), false);
});

void test('a class deleted outright is not wired', () => {
  assert.equal(
    composesRole('.other {\n  display: block;\n}\n', 'fixedSubmit', 'band', AUTHORITY),
    false,
  );
});

void test('a composition of a different role, or from a different module, is not wired', () => {
  const otherRole =
    ".fixedSubmit {\n  composes: inner from '../../../ui/fixedSubmitBar.module.css';\n}\n";
  const otherModule =
    ".fixedSubmit {\n  composes: band from '../../../ui/somethingElse.module.css';\n}\n";

  assert.equal(composesRole(otherRole, 'fixedSubmit', 'band', AUTHORITY), false);
  assert.equal(composesRole(otherModule, 'fixedSubmit', 'band', AUTHORITY), false);
});

void test('a composition elsewhere in the file cannot stand in for a missing one', () => {
  // Anchored on the class's own rule body: `.sibling` composing the role
  // says nothing about `.fixedSubmit`.
  const css =
    ".sibling {\n  composes: band from '../../../ui/fixedSubmitBar.module.css';\n}\n\n.fixedSubmit {\n  z-index: 3;\n}\n";
  assert.equal(composesRole(css, 'fixedSubmit', 'band', AUTHORITY), false);
});

void test('a commented-out composition does not count', () => {
  const css =
    ".fixedSubmit {\n  /* composes: band from '../../../ui/fixedSubmitBar.module.css'; */\n  z-index: 3;\n}\n";
  assert.equal(composesRole(css, 'fixedSubmit', 'band', AUTHORITY), false);
});

void test('a multi-role composition on one line counts for each role it names', () => {
  const css = ".cell {\n  composes: day today from './monthCalendarGrid.module.css';\n}\n";
  assert.equal(composesRole(css, 'cell', 'day', 'monthCalendarGrid.module.css'), true);
  assert.equal(composesRole(css, 'cell', 'today', 'monthCalendarGrid.module.css'), true);
  assert.equal(composesRole(css, 'cell', 'week', 'monthCalendarGrid.module.css'), false);
});

void test('class extraction ignores prose and reads only real rules', () => {
  const css =
    '/* .ghost { display: none } */\n.real {\n  display: flex;\n}\n\n.real:hover .child {\n  color: red;\n}\n';

  // Defined = classes that head their own rule; mentioned = every class the
  // stylesheet names, which is what an authority exports.
  assert.deepEqual(classesDefinedIn(css), ['real']);
  assert.deepEqual([...classesMentionedIn(css)].sort(), ['child', 'real']);
});
