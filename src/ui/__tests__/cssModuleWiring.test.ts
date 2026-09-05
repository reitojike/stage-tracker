import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { type ComponentSource, detectMissingClassReferences } from './cssModuleWiring.ts';
import { type CssModuleFile } from './sharedCssRules.ts';

/*
 * Issue #312 (Codex review of PR #342). The per-consumer class lists this
 * Issue replaced also happened to catch a class disappearing from a CSS
 * module while its call site went on asking for it. cssModuleWiring.ts
 * derives that expectation from the call sites instead of a list; this
 * proves it holds across the repository and that it catches the three
 * concrete regressions the review named.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));

const collect = (directory: string): { sources: ComponentSource[]; modules: CssModuleFile[] } => {
  const sources: ComponentSource[] = [];
  const modules: CssModuleFile[] = [];

  const walk = (current: string) => {
    for (const entry of readdirSync(`${root}/${current}`, { withFileTypes: true })) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith('.module.css')) {
        modules.push({ path, css: readFileSync(`${root}/${path}`, 'utf8') });
      } else if (entry.name.endsWith('.tsx')) {
        sources.push({ path, source: readFileSync(`${root}/${path}`, 'utf8') });
      }
    }
  };

  walk(directory);
  return { sources, modules };
};

const app = collect('src/app');
const ui = collect('src/ui');
const sources = [...app.sources, ...ui.sources];
const modules = [...app.modules, ...ui.modules];

void test('every class a component asks its CSS module for is actually wired', () => {
  assert.ok(sources.length > 50, `only ${String(sources.length)} components found`);

  const violations = detectMissingClassReferences(sources, modules);
  assert.deepEqual(
    violations.map((violation) => violation.message),
    [],
  );
});

// --- the regressions this check exists for ---

const MODULE_PATH = 'src/app/example/_components/Example.module.css';
const COMPONENT_PATH = 'src/app/example/_components/Example.tsx';

const check = (css: string, source: string) =>
  detectMissingClassReferences(
    [{ path: COMPONENT_PATH, source: `import styles from './Example.module.css';\n${source}` }],
    [{ path: MODULE_PATH, css }],
  );

void test('a class deleted from the module while the call site still asks for it fails', () => {
  // The three cases the PR #342 review named: a fixed submit bar that stops
  // being fixed, sr-only text that becomes visible, a selected-day ring that
  // disappears - each one a deleted class block, each one previously caught
  // only by a hand-kept consumer list.
  const violations = check(
    ".fixedSubmitInner {\n  composes: inner from '../../../ui/fixedSubmitBar.module.css';\n}\n",
    '<div className={styles.fixedSubmit} />',
  );
  assert.equal(violations.length, 1);
  const [violation] = violations;
  assert.ok(violation !== undefined);
  assert.equal(violation.className, 'fixedSubmit');
  assert.match(violation.message, /resolves to undefined/);
});

void test('a class reached only through a bracket literal is checked too', () => {
  const violations = check(
    '.dayNumber {\n  height: 22px;\n}\n',
    "<span className={styles['today']} />",
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.className, 'today');
});

void test('an intentionally empty rule counts as defined', () => {
  // WriteNotice.module.css keeps `.noticeRegion {}` as a stable hook for its
  // live region. An empty rule is a visible authoring choice, unlike a class
  // that is simply not there.
  assert.deepEqual(check('.noticeRegion {\n}\n', '<div className={styles.noticeRegion} />'), []);
});

// --- what must not fail ---

void test('a class carried only by a composition, a pseudo-class or a compound selector is wired', () => {
  assert.deepEqual(
    check(
      ".day {\n  composes: day from '../../../ui/monthCalendarGrid.module.css';\n}\n\n" +
        '.itemLink:hover {\n  background-color: var(--color-surface-subtle);\n}\n\n' +
        '.dayNumber.today {\n  background-color: var(--color-neutral-300);\n}\n',
      '<a className={`${styles.day} ${styles.itemLink} ${styles.today}`} />',
    ),
    [],
  );
});

void test('a computed lookup is skipped rather than guessed at', () => {
  // MyMonthCalendar builds `styles[variantClass]` from its legend data; the
  // name is not statically knowable, so this check says nothing about it.
  assert.deepEqual(
    check('.dotFilled {\n  opacity: 1;\n}\n', '<span className={styles[variantClass]} />'),
    [],
  );
});

void test('a module the component does not import is not consulted', () => {
  assert.deepEqual(
    detectMissingClassReferences(
      [{ path: COMPONENT_PATH, source: '<div className={other.missing} />' }],
      [{ path: MODULE_PATH, css: '.present {\n  display: block;\n}\n' }],
    ),
    [],
  );
});
