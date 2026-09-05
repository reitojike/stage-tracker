/*
 * Shared-rule redeclaration detector (Issue #312).
 *
 * Decided shared UI rules have one authority module each. Before this
 * detector, keeping a consumer from restating one of those rules meant
 * listing that consumer by hand in a test (Row.test.ts's migratedRows /
 * migratedMains / migratedAsides, pendingLabel.test.ts's CONSUMERS,
 * MonthCalendar/MyMonthCalendar's own 19-class lists, ...), so every new
 * consumer had to be registered in one more list and every change to a
 * shared rule had to be chased through several of them.
 *
 * This module replaces those lists with two deterministic checks over
 * every `*.module.css` under src/app/ and src/ui/:
 *
 *   A. composed-role redeclaration - a rule that composes a role from an
 *      authority must not also declare a property that role owns.
 *   B. authority signature - a handful of idioms that belong to exactly one
 *      named role (the visually-hidden clip, the pending label's sizing
 *      copy, the fixed submit bar's nav offset, the 44px tap-target
 *      expansion, the disabled opacity token) must not appear outside their
 *      authority, even in a brand-new file that composes nothing.
 *
 * A third check was tried and dropped: "a file that composes from an
 * authority must not define a class of its own under one of that
 * authority's exported names". It read as narrow, but on the current tree
 * it flagged HomeDeadlineList's `.row` (a horizontal-scroll card list that
 * merely shares the word) and CalendarSkeleton's `.header`/`.week`/`.day`
 * (placeholders Issue #314 decided on purpose not to compose). Narrowing it
 * further would have meant scoring how much of a rule matches the shared
 * one - the declaration-set matching this Issue rules out - so the check is
 * gone rather than carrying site-specific exceptions. Keeping a consumer
 * wired to a shared presentation module stays a bounded wiring assertion in
 * that module's own test (monthCalendarGrid.test.ts, selectedDayList.test.ts).
 *
 * What it deliberately does NOT do (Issue #312's own boundary): it never
 * infers a shared role from a declaration set that merely happens to match
 * somewhere else, and it never treats a single generic declaration
 * (`justify-content: space-between`, `flex`, `min-width`, `flex-shrink`, a
 * vertical `flex-direction: column` stack, a list reset, a
 * `--color-text-secondary` sub-line, a forwarded focus ring - see
 * docs/ux-ui.md "共通化しないと決めた反復", Issue #319) as a violation.
 * Unknown duplication is an investigation input, not a CI failure, so it is
 * not detected here at all.
 *
 * Every entry below carries its authority, why the rule exists, a violating
 * example and a legitimate one; sharedCssRules.test.ts runs both examples
 * through the detector, so the catalog cannot drift from what it detects.
 */

export interface CssDeclaration {
  readonly property: string;
  readonly value: string;
}

export interface CssRule {
  readonly selector: string;
  readonly declarations: readonly CssDeclaration[];
  /** Enclosing at-rule preludes, outermost first (`@media (...)`). */
  readonly atContext: readonly string[];
}

export interface CssModuleFile {
  /** Repository-relative, POSIX separators. */
  readonly path: string;
  readonly css: string;
}

export interface SharedRuleViolation {
  readonly ruleId: string;
  readonly file: string;
  readonly selector: string;
  /** The offending declaration, as written. */
  readonly declaration: string;
  readonly authority: string;
  readonly message: string;
}

/** A CSS snippet used as a worked example of a catalog entry. */
export interface CatalogExample {
  readonly path: string;
  readonly css: string;
}

/*
 * --- Parsing -------------------------------------------------------------
 *
 * Deliberately minimal (Issue #312: "大きな parser を先に作らない"). It has
 * to survive comments, quoted strings, selector lists and at-rules without
 * mistaking any of them for a declaration - nothing more.
 */

const readString = (source: string, start: number): number => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }
  return index;
};

/** Strips comments without touching comment openers inside quoted strings. */
export const stripComments = (css: string): string => {
  let out = '';
  let index = 0;
  while (index < css.length) {
    const char = css[index] ?? '';
    if (char === '"' || char === "'") {
      const end = readString(css, index);
      out += css.slice(index, end);
      index = end;
      continue;
    }
    if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 2;
      out += ' ';
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
};

const splitTopLevel = (body: string, separator: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? '';
    if (char === '"' || char === "'") {
      const end = readString(body, index);
      current += body.slice(index, end);
      index = end;
      continue;
    }
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  parts.push(current);
  return parts;
};

const parseDeclarations = (body: string): CssDeclaration[] =>
  splitTopLevel(body, ';').flatMap((part) => {
    const trimmed = part.trim();
    if (trimmed === '') {
      return [];
    }
    const separated = splitTopLevel(trimmed, ':');
    if (separated.length < 2) {
      return [];
    }
    const property = (separated[0] ?? '').trim().toLowerCase();
    const value = separated.slice(1).join(':').trim();
    if (property === '' || value === '') {
      return [];
    }
    return [{ property, value }];
  });

/**
 * Flattens a stylesheet into its rules. At-rule blocks contribute their
 * inner rules (`@media`) except `@keyframes`, whose percentage blocks are
 * not selectors and carry no shared-role meaning.
 */
export const parseCssRules = (css: string): CssRule[] => {
  const source = stripComments(css);
  const rules: CssRule[] = [];
  const preludes: string[] = [];
  let buffer = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? '';
    if (char === '"' || char === "'") {
      const end = readString(source, index);
      buffer += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === '{') {
      preludes.push(buffer.trim());
      buffer = '';
      index += 1;
      continue;
    }
    if (char === '}') {
      const prelude = preludes.pop() ?? '';
      const body = buffer;
      buffer = '';
      index += 1;
      const insideKeyframes = preludes.some((outer) => /^@(-\w+-)?keyframes\b/.test(outer));
      if (prelude !== '' && !prelude.startsWith('@') && !insideKeyframes) {
        rules.push({
          selector: prelude.replace(/\s+/g, ' ').trim(),
          declarations: parseDeclarations(body),
          atContext: preludes.filter((outer) => outer.startsWith('@')),
        });
      }
      continue;
    }
    buffer += char;
    index += 1;
  }

  return rules;
};

/**
 * One entry per selector branch within an at-rule context, carrying every
 * declaration written for that branch.
 *
 * CSS lets the same selector appear more than once, so a rule's meaning is
 * the union of its blocks, not whichever block happens to be read first: a
 * consumer that composes a shared role in one block and restates part of it
 * in a later block has still restated it, and a signature whose two halves
 * sit in separate blocks is still that signature.
 *
 * Selector *lists* are split first, so `.sizing, .other { visibility:
 * hidden }` and `.sizing { pointer-events: none }` meet on `.sizing` rather
 * than being kept apart by the company `.sizing` keeps in one of the two
 * blocks (PR #342 closure review). Splitting is top-level only, so a comma
 * inside `:not(...)` / `:is(...)` stays part of its branch.
 *
 * At-rule contexts stay separate - a `@media` block is a conditional
 * override, not more of the same rule.
 */
export const mergeRulesBySelectorBranch = (rules: readonly CssRule[]): CssRule[] => {
  const merged = new Map<string, { rule: CssRule; declarations: CssDeclaration[] }>();

  for (const rule of rules) {
    for (const raw of splitTopLevel(rule.selector, ',')) {
      const selector = raw.replace(/\s+/g, ' ').trim();
      if (selector === '') {
        continue;
      }
      const key = `${rule.atContext.join('|')}||${selector}`;
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, {
          rule: { selector, atContext: rule.atContext, declarations: [] },
          declarations: [...rule.declarations],
        });
        continue;
      }
      existing.declarations.push(...rule.declarations);
    }
  }

  return [...merged.values()].map(({ rule, declarations }) => ({
    selector: rule.selector,
    atContext: rule.atContext,
    declarations,
  }));
};

const CLASS_PATTERN = /\.(-?[_a-zA-Z][\w-]*)/g;
const SINGLE_CLASS_PATTERN = /^\.(-?[_a-zA-Z][\w-]*)$/;

const selectorClasses = (selector: string): string[] =>
  [...selector.matchAll(CLASS_PATTERN)].map((match) => match[1] ?? '');

const singleClassName = (selector: string): string | null =>
  SINGLE_CLASS_PATTERN.exec(selector)?.[1] ?? null;

const normalizeValue = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();

const posixDirname = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

const resolveRelative = (fromFile: string, specifier: string): string => {
  const segments = `${posixDirname(fromFile)}/${specifier}`.split('/');
  const out: string[] = [];
  for (const segment of segments) {
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

interface ComposesReference {
  readonly names: readonly string[];
  /** Repository-relative authority path, or null for a local composition. */
  readonly from: string | null;
}

const parseComposes = (file: string, value: string): ComposesReference => {
  const external = /^(.+?)\s+from\s+(['"])(.+?)\2$/.exec(value.trim());
  if (external) {
    return {
      names: (external[1] ?? '').trim().split(/\s+/),
      from: resolveRelative(file, external[3] ?? ''),
    };
  }
  return { names: value.trim().split(/\s+/), from: null };
};

/*
 * --- Catalog: authority modules (checks A and C) -------------------------
 */

export interface AuthorityModule {
  readonly id: string;
  readonly authority: string;
  readonly role: string;
  readonly reason: string;
  /**
   * Owned properties a consumer may still set to a *different* value as a
   * documented screen-local exception. Restating the authority's own value
   * stays a violation - that is a copy, not an exception.
   */
  readonly locallyOverridable: readonly string[];
  readonly violationExample: CatalogExample;
  readonly legitimateExample: CatalogExample;
}

const EXAMPLE_PATH = 'src/app/example/_components/Example.module.css';

export const AUTHORITY_MODULES: readonly AuthorityModule[] = [
  {
    id: 'row',
    authority: 'src/ui/row.module.css',
    role: 'row / main / aside / inlineBadge - the variable text + trailing action/metadata row',
    reason:
      'docs/ux-ui.md "可変text/content + trailing action/metadataのrow" (Issue #271/#311): the flex sizing of this named role has one authority. Restating it in a consumer is how the role drifts apart again.',
    // docs/ux-ui.md: "既存surfaceのbaseline/flex-start/gap等のvisual exception
    // はscreen-localで維持します" - a *different* alignment/gap is a decided
    // screen-local exception, so only a verbatim copy is a violation.
    locallyOverridable: ['align-items', 'gap'],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".item {\n  composes: main from '../../../ui/row.module.css';\n  min-width: 0;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        ".item {\n  composes: row from '../../../ui/row.module.css';\n  align-items: flex-start;\n}\n\n" +
        '.stack {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-md);\n}\n\n' +
        '.plainRow {\n  display: flex;\n  justify-content: space-between;\n}\n',
    },
  },
  {
    id: 'pendingLabel',
    authority: 'src/ui/pendingLabel.module.css',
    role: 'label / sizing - the width-stable pending label overlay',
    reason:
      'Issue #308: six modules carried this overlay across 17 call sites. The stacked cell and the hidden sizing copy are one contract with one authority.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".stablePendingLabel {\n  composes: label from '../../../ui/pendingLabel.module.css';\n  display: grid;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        ".stablePendingLabel {\n  composes: label from '../../../ui/pendingLabel.module.css';\n}\n\n" +
        '.fields {\n  display: grid;\n  gap: var(--space-md);\n}\n',
    },
  },
  {
    id: 'fixedSubmitBar',
    authority: 'src/ui/fixedSubmitBar.module.css',
    role: 'band / inner / escape - the submit bar fixed above PrimaryNav',
    reason:
      'Issue #316: the Event and Schedule write forms had drifted apart on the safe area and on the escape spacing (72px vs 128px). The offset, the bounded inner column and the escape spacing are single-valued.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".form {\n  composes: escape from '../../../ui/fixedSubmitBar.module.css';\n  padding-bottom: 128px;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: ".form {\n  composes: escape from '../../../ui/fixedSubmitBar.module.css';\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-md);\n}\n",
    },
  },
  {
    id: 'visuallyHidden',
    authority: 'src/ui/visuallyHidden.module.css',
    role: 'visuallyHidden / visuallyHiddenRegion - hidden visually, kept in the DOM',
    reason:
      'Issue #317: four techniques across six sites. The clip technique stays in one place so a control never loses focusability or its accessible name to a local copy.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".input {\n  composes: visuallyHidden from '../../../ui/visuallyHidden.module.css';\n  position: absolute;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: ".input {\n  composes: visuallyHidden from '../../../ui/visuallyHidden.module.css';\n  outline: none;\n}\n",
    },
  },
  {
    id: 'monthCalendarGrid',
    authority: 'src/ui/monthCalendarGrid.module.css',
    role: 'the month calendar header / weekday row / week grid / date cell presentation',
    reason:
      'Issue #314: MyMonthCalendar and the Catalog MonthCalendar carried this presentation byte-for-byte. Both now compose it, and CalendarSkeleton composes the weekday header from the same place.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".day {\n  composes: day from '../../../ui/monthCalendarGrid.module.css';\n  min-height: 44px;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        ".day {\n  composes: day from '../../../ui/monthCalendarGrid.module.css';\n}\n\n" +
        '.markerRow {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  min-height: 9px;\n}\n',
    },
  },
  {
    id: 'selectedDayList',
    authority: 'src/ui/selectedDayList.module.css',
    role: 'list / heading / items / itemLink / itemBody / time / title / venue - the selected-day list presentation',
    reason:
      'Issue #315: three implementations of the same list. Row membership, separators and content stay screen-local; this presentation does not.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".title {\n  composes: title from '../../../ui/selectedDayList.module.css';\n  font-weight: var(--font-weight-semibold);\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        ".title {\n  composes: title from '../../../ui/selectedDayList.module.css';\n}\n\n" +
        '.items > li + li {\n  border-top: 1px solid var(--color-border);\n}\n',
    },
  },
  {
    id: 'tapTarget',
    authority: 'src/ui/tapTarget.module.css',
    role: 'expand44 - the WCAG 2.2 SC 2.5.8 tap-target expansion',
    reason:
      'docs/ux-ui.md accessibility baseline: the 44px target is the rule itself, not an implementation detail, and Button/BackLink compose it rather than each carrying the ::before.',
    locallyOverridable: [],
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".control {\n  composes: expand44 from '../../../ui/tapTarget.module.css';\n  position: relative;\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: ".control {\n  composes: expand44 from '../../../ui/tapTarget.module.css';\n  min-height: 35px;\n}\n",
    },
  },
];

/*
 * --- Catalog: authority signatures (check B) -----------------------------
 *
 * Each signature is a combination that only one named role produces. A
 * single generic declaration is never a signature: `pointer-events: none`
 * on its own is a decorative overlay, `position: fixed` on its own is
 * Sheet's dialog, `env(safe-area-inset-bottom)` on its own is PrimaryNav's
 * own padding, and `opacity` on its own is a loading state.
 */

export interface SignatureRule {
  readonly id: string;
  readonly authority: string;
  readonly role: string;
  readonly reason: string;
  /** Files allowed to carry the signature (the authority itself). */
  readonly allowedFiles: readonly string[];
  /** Returns the offending declaration, or null. */
  readonly match: (rule: CssRule) => CssDeclaration | null;
  readonly violationExample: CatalogExample;
  readonly legitimateExample: CatalogExample;
}

/**
 * The declaration that actually applies for a property: the last one
 * written, not the first.
 *
 * Merged rules concatenate the blocks in source order, so reading the first
 * entry would answer with a value the cascade has already replaced - a
 * `.sizing { visibility: visible }` earlier in the file would hide the
 * `visibility: hidden` that follows it (PR #342 closure review).
 */
const declarationOf = (rule: CssRule, property: string): CssDeclaration | null =>
  rule.declarations.findLast((entry) => entry.property === property) ?? null;

const hasValue = (rule: CssRule, property: string, value: string): boolean =>
  normalizeValue(declarationOf(rule, property)?.value ?? '') === value;

export const SIGNATURE_RULES: readonly SignatureRule[] = [
  {
    id: 'visually-hidden-clip',
    authority: 'src/ui/visuallyHidden.module.css',
    role: 'visually hidden',
    reason:
      'Issue #317: clipping an element to zero area while leaving it in the DOM is the visually-hidden role itself. A second copy is how the four pre-#317 techniques came back.',
    allowedFiles: ['src/ui/visuallyHidden.module.css'],
    match: (rule) => {
      const clipPath = declarationOf(rule, 'clip-path');
      if (clipPath !== null && /inset\(\s*50%\s*\)/.test(clipPath.value)) {
        return clipPath;
      }
      const legacyClip = declarationOf(rule, 'clip');
      if (legacyClip !== null && normalizeValue(legacyClip.value).startsWith('rect(')) {
        return legacyClip;
      }
      return null;
    },
    violationExample: {
      path: EXAMPLE_PATH,
      css: '.srOnly {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  overflow: hidden;\n  clip-path: inset(50%);\n}\n',
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: '.avatar {\n  clip-path: circle(50%);\n}\n',
    },
  },
  {
    id: 'pending-label-sizing-copy',
    authority: 'src/ui/pendingLabel.module.css',
    role: 'pending label sizing copy',
    reason:
      'Issue #308: a copy that keeps its box but takes no taps is the sizing half of the width-stable pending label. Six modules owned this before the shared authority existed.',
    allowedFiles: ['src/ui/pendingLabel.module.css'],
    match: (rule) => {
      if (!hasValue(rule, 'visibility', 'hidden') || !hasValue(rule, 'pointer-events', 'none')) {
        return null;
      }
      return declarationOf(rule, 'visibility');
    },
    violationExample: {
      path: EXAMPLE_PATH,
      css: '.sizingCopy {\n  visibility: hidden;\n  pointer-events: none;\n}\n',
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: '.decoration {\n  pointer-events: none;\n  opacity: 0.5;\n}\n',
    },
  },
  {
    id: 'fixed-submit-bar-safe-area',
    authority: 'src/ui/fixedSubmitBar.module.css',
    role: 'fixed submit bar',
    reason:
      'Issue #316: a bar fixed over the page that clears the safe area is the submit band. The two pre-#316 copies had already drifted on exactly this term.',
    allowedFiles: ['src/ui/fixedSubmitBar.module.css'],
    match: (rule) => {
      if (!hasValue(rule, 'position', 'fixed')) {
        return null;
      }
      return (
        rule.declarations.find((entry) => entry.value.includes('env(safe-area-inset-bottom')) ??
        null
      );
    },
    violationExample: {
      path: EXAMPLE_PATH,
      css: '.band {\n  position: fixed;\n  inset-inline: 0;\n  bottom: calc(60px + env(safe-area-inset-bottom, 0px));\n}\n',
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        '.dialog {\n  position: fixed;\n  inset: 0;\n}\n\n' +
        '.nav {\n  position: sticky;\n  padding-bottom: env(safe-area-inset-bottom, 0px);\n}\n',
    },
  },
  {
    id: 'primary-nav-row-height',
    authority: 'src/ui/fixedSubmitBar.module.css',
    role: 'fixed submit bar nav offset',
    reason:
      'Issue #316: the bar names PrimaryNav’s own row height in one place, pinned to PrimaryNav .link { min-height } by fixedSubmitBar.test.ts. A second declaration is a second authority for that offset.',
    allowedFiles: ['src/ui/fixedSubmitBar.module.css'],
    match: (rule) => declarationOf(rule, '--primary-nav-row-height'),
    violationExample: {
      path: EXAMPLE_PATH,
      css: '.band {\n  --primary-nav-row-height: 60px;\n}\n',
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: '.band {\n  bottom: 60px;\n}\n',
    },
  },
  {
    id: 'tap-target-expand-44',
    authority: 'src/ui/tapTarget.module.css',
    role: 'tap target expansion',
    reason:
      'docs/ux-ui.md accessibility baseline (WCAG 2.2 SC 2.5.8): growing a control’s hit area to at least 44x44 without growing its fill is one shared pseudo-element, composed by every control that needs it.',
    allowedFiles: ['src/ui/tapTarget.module.css'],
    match: (rule) => {
      const width = declarationOf(rule, 'width');
      const height = declarationOf(rule, 'height');
      const expands = (entry: CssDeclaration | null): boolean =>
        entry !== null && /^max\(\s*100%\s*,\s*44px\s*\)$/.test(normalizeValue(entry.value));
      return expands(width) && expands(height) ? width : null;
    },
    violationExample: {
      path: EXAMPLE_PATH,
      css: ".control::before {\n  content: '';\n  position: absolute;\n  width: max(100%, 44px);\n  height: max(100%, 44px);\n}\n",
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css: '.control {\n  min-width: 40px;\n  min-height: 40px;\n}\n',
    },
  },
  {
    id: 'disabled-opacity-token',
    authority: 'src/ui/tokens.css (--opacity-disabled)',
    role: 'disabled state',
    reason:
      'Issue #324: the disabled dimming across Button / TextInput / checkbox / segment / choice is one semantic token, so the value has one place to change.',
    allowedFiles: [],
    match: (rule) => {
      if (!hasValue(rule, 'cursor', 'not-allowed')) {
        return null;
      }
      const opacity = declarationOf(rule, 'opacity');
      if (opacity === null || normalizeValue(opacity.value) === 'var(--opacity-disabled)') {
        return null;
      }
      return opacity;
    },
    violationExample: {
      path: EXAMPLE_PATH,
      css: '.control:disabled {\n  cursor: not-allowed;\n  opacity: 0.6;\n}\n',
    },
    legitimateExample: {
      path: EXAMPLE_PATH,
      css:
        '.control:disabled {\n  cursor: not-allowed;\n  opacity: var(--opacity-disabled);\n}\n\n' +
        '.skeleton {\n  opacity: 0.6;\n}\n',
    },
  },
];

/*
 * --- Detection -----------------------------------------------------------
 */

interface AuthorityShape {
  /** Every class name the authority module exports. */
  readonly names: ReadonlySet<string>;
  /** Properties (and their values) each bare `.name { ... }` rule owns. */
  readonly owned: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

const authorityShape = (css: string): AuthorityShape => {
  const names = new Set<string>();
  const owned = new Map<string, Map<string, string>>();

  for (const rule of mergeRulesBySelectorBranch(parseCssRules(css))) {
    for (const name of selectorClasses(rule.selector)) {
      names.add(name);
    }
    const single = singleClassName(rule.selector);
    if (single === null) {
      continue;
    }
    const properties = owned.get(single) ?? new Map<string, string>();
    for (const entry of rule.declarations) {
      if (entry.property === 'composes') {
        continue;
      }
      properties.set(entry.property, normalizeValue(entry.value));
    }
    owned.set(single, properties);
  }

  return { names, owned };
};

const describeDeclaration = (selector: string, entry: CssDeclaration): string =>
  `${selector} { ${entry.property}: ${entry.value}; }`;

export const detectSharedRuleViolations = (
  files: readonly CssModuleFile[],
): SharedRuleViolation[] => {
  const violations: SharedRuleViolation[] = [];
  const shapes = new Map<string, AuthorityShape>();

  for (const module of AUTHORITY_MODULES) {
    const source = files.find((file) => file.path === module.authority);
    if (source !== undefined) {
      shapes.set(module.authority, authorityShape(source.css));
    }
  }

  for (const file of files) {
    const rules = mergeRulesBySelectorBranch(parseCssRules(file.css));

    // --- B. authority signatures ---
    for (const signature of SIGNATURE_RULES) {
      if (signature.allowedFiles.includes(file.path)) {
        continue;
      }
      for (const rule of rules) {
        const offending = signature.match(rule);
        if (offending === null) {
          continue;
        }
        violations.push({
          ruleId: signature.id,
          file: file.path,
          selector: rule.selector,
          declaration: describeDeclaration(rule.selector, offending),
          authority: signature.authority,
          message: `${file.path}: ${describeDeclaration(rule.selector, offending)} restates the "${signature.role}" rule, whose authority is ${signature.authority}. ${signature.reason}`,
        });
      }
    }

    // --- A. composed-role redeclaration ---
    for (const rule of rules) {
      for (const entry of rule.declarations) {
        if (entry.property !== 'composes') {
          continue;
        }
        const reference = parseComposes(file.path, entry.value);
        if (reference.from === null || reference.from === file.path) {
          continue;
        }

        const module = AUTHORITY_MODULES.find(
          (entryModule) => entryModule.authority === reference.from,
        );
        const shape = module === undefined ? undefined : shapes.get(module.authority);
        if (module === undefined || shape === undefined) {
          continue;
        }

        const ownedHere = new Map<string, string>();
        for (const name of reference.names) {
          for (const [property, value] of shape.owned.get(name) ?? []) {
            ownedHere.set(property, value);
          }
        }

        // One verdict per property, on the declaration that actually
        // applies. Reading every entry of a merged rule would judge a value
        // the cascade has already replaced (PR #342 closure review).
        for (const property of new Set(rule.declarations.map((entry) => entry.property))) {
          if (property === 'composes') {
            continue;
          }
          const sharedValue = ownedHere.get(property);
          if (sharedValue === undefined) {
            continue;
          }
          const declared = declarationOf(rule, property);
          if (declared === null) {
            continue;
          }
          const restatesValue = normalizeValue(declared.value) === sharedValue;
          if (!restatesValue && module.locallyOverridable.includes(property)) {
            continue;
          }
          const what = restatesValue
            ? 'restates a declaration the composed role already owns'
            : 'overrides a declaration the composed role owns';
          violations.push({
            ruleId: module.id,
            file: file.path,
            selector: rule.selector,
            declaration: describeDeclaration(rule.selector, declared),
            authority: module.authority,
            message: `${file.path}: ${describeDeclaration(rule.selector, declared)} ${what} (composes ${reference.names.join(' ')} from ${module.authority}). ${module.reason}`,
          });
        }
      }
    }
  }

  return violations;
};

/**
 * The classes an authority module exports, and the value each bare
 * `.name { ... }` rule owns. Exposed for the bounded wiring assertions that
 * live with the shared presentation modules themselves - the detector above
 * does not use it to guess at role membership.
 */
export const authorityExports = (css: string): ReadonlySet<string> => authorityShape(css).names;

/** Whether `.name` in `css` composes `name` from `authority`. */
export const composesRole = (file: CssModuleFile, name: string, authority: string): boolean =>
  parseCssRules(file.css).some(
    (rule) =>
      singleClassName(rule.selector) === name &&
      rule.declarations.some((entry) => {
        if (entry.property !== 'composes') {
          return false;
        }
        const reference = parseComposes(file.path, entry.value);
        return reference.from === authority && reference.names.includes(name);
      }),
  );

/** The single-class names a module defines. */
export const definedClasses = (css: string): readonly string[] =>
  parseCssRules(css).flatMap((rule) => {
    const name = singleClassName(rule.selector);
    return name === null ? [] : [name];
  });
