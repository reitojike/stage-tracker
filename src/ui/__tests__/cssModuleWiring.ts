/*
 * CSS Module wiring check (Issue #312, Codex review of PR #342).
 *
 * sharedCssRules.ts catches a module that *restates* a decided shared rule.
 * It cannot catch a module that stops carrying one at all: delete
 * `.fixedSubmit` from EventWriteForm.module.css and the submit bar simply
 * stops being fixed; delete `.srOnly` from TicketOpportunityRow.module.css
 * and screen-reader-only text becomes visible; delete `.daySelected` from
 * MonthCalendar.module.css and the selected-day ring disappears. In every
 * case the TSX still asks for the class, `styles.<name>` resolves to
 * undefined, and nothing fails.
 *
 * The per-consumer lists this Issue replaced (Row.test.ts's migrated*,
 * MonthCalendar/MyMonthCalendar's 19 names, visuallyHidden's consumer
 * census, ...) used to cover that by naming every class by hand. This
 * derives the same expectation from the call sites instead: whatever a
 * component actually asks its CSS module for has to exist there and has to
 * do something. No registry, and a new consumer or a renamed class needs no
 * update anywhere.
 *
 * Deliberately static and deliberately small: only `styles.name` and
 * `styles['name']` are resolvable, so a computed lookup
 * (`styles[variantClass]`) is skipped rather than guessed at.
 */

import { type CssModuleFile, parseCssRules } from './sharedCssRules.ts';

export interface ComponentSource {
  /** Repository-relative, POSIX separators. */
  readonly path: string;
  readonly source: string;
}

export interface WiringViolation {
  readonly file: string;
  readonly module: string;
  readonly className: string;
  readonly message: string;
}

const posixDirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

const resolveRelative = (fromFile: string, specifier: string): string => {
  const out: string[] = [];
  for (const segment of `${posixDirname(fromFile)}/${specifier}`.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
};

/**
 * Every class name the module defines, through any of its rules - a bare
 * `.name`, a pseudo-class, a compound or descendant selector.
 *
 * An intentionally empty rule counts as defined (`WriteNotice.module.css`
 * keeps `.noticeRegion {}` as a stable hook for its live region). An empty
 * rule is a visible authoring choice; what this check is for is the class
 * that is not there at all while a call site still asks for it.
 */
const definedClassNames = (css: string): ReadonlySet<string> => {
  const defined = new Set<string>();
  for (const rule of parseCssRules(css)) {
    for (const match of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
      defined.add(match[1] ?? '');
    }
  }
  return defined;
};

/** `import styles from './X.module.css'` bindings, by local name. */
const moduleBindings = (file: ComponentSource): ReadonlyMap<string, string> => {
  const bindings = new Map<string, string>();
  for (const match of file.source.matchAll(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+\.module\.css)['"]/g,
  )) {
    bindings.set(match[1] ?? '', resolveRelative(file.path, match[2] ?? ''));
  }
  return bindings;
};

/** Statically resolvable `binding.name` / `binding['name']` references. */
const referencedClasses = (source: string, binding: string): ReadonlySet<string> => {
  const escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new Set<string>();
  for (const match of source.matchAll(new RegExp(`\\b${escaped}\\.([A-Za-z_$][\\w$]*)\\b`, 'g'))) {
    names.add(match[1] ?? '');
  }
  for (const match of source.matchAll(
    new RegExp(`\\b${escaped}\\[\\s*(['"])([^'"]+)\\1\\s*\\]`, 'g'),
  )) {
    names.add(match[2] ?? '');
  }
  return names;
};

export const detectMissingClassReferences = (
  sources: readonly ComponentSource[],
  modules: readonly CssModuleFile[],
): WiringViolation[] => {
  const violations: WiringViolation[] = [];
  const definedByModule = new Map(
    modules.map((module) => [module.path, definedClassNames(module.css)] as const),
  );

  for (const file of sources) {
    for (const [binding, modulePath] of moduleBindings(file)) {
      const defined = definedByModule.get(modulePath);
      if (defined === undefined) {
        continue;
      }
      for (const className of referencedClasses(file.source, binding)) {
        if (defined.has(className)) {
          continue;
        }
        violations.push({
          file: file.path,
          module: modulePath,
          className,
          message: `${file.path}: ${binding}.${className} resolves to undefined - ${modulePath} defines no .${className}. Whatever the class carried (a composed shared role, its own presentation) is silently gone from this call site.`,
        });
      }
    }
  }

  return violations;
};
