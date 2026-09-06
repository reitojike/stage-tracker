import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// No jsdom/React Testing Library in this project's toolchain (test:unit runs
// on plain `node --test`), so this guards the shared primitive's source/CSS
// contract and its existing consumers the same way the other UI tests do.
const componentPath = fileURLToPath(new URL('../Sheet.tsx', import.meta.url));
const cssPath = fileURLToPath(new URL('../Sheet.module.css', import.meta.url));
const participationPath = fileURLToPath(
  new URL('../../app/catalog/_components/ParticipationSheet.tsx', import.meta.url),
);
const invitePath = fileURLToPath(
  new URL('../../app/catalog/_components/InviteSheet.tsx', import.meta.url),
);
const component = readFileSync(componentPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const participation = readFileSync(participationPath, 'utf8');
const invite = readFileSync(invitePath, 'utf8');

void test('owns the native dialog lifecycle used by every Sheet consumer', () => {
  assert.match(component, /<dialog\b/);
  assert.match(component, /dialog\.showModal\(\)/);
  assert.match(component, /dialog\.close\(\)/);

  const onCloseHandler = component.match(/onClose=\{\(\) => \{([\s\S]*?)\}\}/);
  assert.ok(onCloseHandler, 'Sheet is missing its native close handler');
  assert.match(onCloseHandler[1] ?? '', /onOpenChange\(false\)/);
});

void test('owns native backdrop dismissal and routes it through the same close event', () => {
  assert.match(component, /event\.target === dialogRef\.current/);
  assert.match(component, /dialogRef\.current\.close\(\)/);
});

void test('keeps Escape dismissal on the shared native close path', () => {
  assert.match(component, /onKeyDown=\{\(event\) => \{/);
  assert.match(component, /event\.key === 'Escape'/);
  assert.match(component, /event\.preventDefault\(\)/);
  assert.match(component, /event\.stopPropagation\(\)/);
  assert.match(component, /dialogRef\.current\?\.close\(\)/);
});

void test('renders the shared header while allowing FilterSheet to keep its footer-only affordance', () => {
  assert.match(component, /<div className=\{styles\.header\}>/);
  assert.match(component, /<p id=\{titleId\} className=\{styles\.title\}>/);
  assert.match(component, /showCloseButton = true/);
  assert.match(component, /\{showCloseButton \? \(/);
  assert.match(component, />\s*閉じる\s*<\/Button>/);
});

void test('renders the optional footer outside the scrollable body', () => {
  const bodyAndFooter = component.match(
    /<div className=\{\[styles\.body, bodyClassName\][\s\S]*?<\/div>\s*\{footer == null \? null : <div className=\{styles\.footer\}>\{footer\}<\/div>\}/,
  );
  assert.ok(bodyAndFooter, 'footer must follow the body instead of being nested in it');
  assert.match(component, /bodyClassName\?: string/);
  assert.match(component, /footer\?: ReactNode/);
});

// A ReactNode that renders no DOM - `footer={canSubmit && <Actions />}`, an
// empty fragment, an empty array, or a component that returns null - is not
// nullish, so the wrapper above is still created for it. What collapses the
// bar is the rendered result, not a JS re-derivation of React's renderability
// rules for every ReactNode shape (Issue #318).
void test('collapses the footer bar when the slot rendered no DOM', () => {
  const emptyRule = css.match(/(?:^|\n)\.footer:empty\s*\{([^}]*)\}/);
  assert.ok(emptyRule, '.footer:empty rule is missing from Sheet.module.css');
  assert.match(emptyRule[1] ?? '', /display:\s*none\s*;/);
});

void test('does not retain the removed dead close-button class API', () => {
  const removedPropName = ['closeButton', 'ClassName'].join('');
  assert.doesNotMatch(component, new RegExp(removedPropName));
});

void test('shared frame preserves bottom anchoring, modal surface, and bounded height', () => {
  const dialogRule = css.match(/(?:^|\n)\.dialog\s*\{([^}]*)\}/);
  assert.ok(dialogRule, '.dialog rule is missing from Sheet.module.css');
  assert.match(dialogRule[1] ?? '', /inset-block-start:\s*auto\s*;/);
  assert.match(dialogRule[1] ?? '', /inset-block-end:\s*0\s*;/);
  assert.match(dialogRule[1] ?? '', /max-width:\s*480px\s*;/);
  assert.match(dialogRule[1] ?? '', /max-height:\s*85vh\s*;/);
  assert.match(dialogRule[1] ?? '', /background-color:\s*var\(--color-canvas\)\s*;/);
});

void test('shared body remains the scroll region needed to keep a slotted footer reachable', () => {
  const bodyRule = css.match(/(?:^|\n)\.body\s*\{([^}]*)\}/);
  assert.ok(bodyRule, '.body rule is missing from Sheet.module.css');
  assert.match(bodyRule[1] ?? '', /overflow-y:\s*auto\s*;/);
});

// Issue #318: the footer slot is Sheet's, so the bar it renders is Sheet's
// too. This is the one place the shared footer declarations are asserted -
// consumers pass actions and keep only per-action sizing, so there is no
// composition for them to lose and no per-consumer copy of this to check.
void test('owns the slotted footer bar rather than leaving it to each consumer', () => {
  const footerRule = css.match(/(?:^|\n)\.footer\s*\{([^}]*)\}/);
  assert.ok(footerRule, '.footer rule is missing from Sheet.module.css');
  const declarations = footerRule[1] ?? '';
  assert.match(declarations, /display:\s*flex\s*;/);
  assert.match(declarations, /justify-content:\s*flex-end\s*;/);
  assert.match(declarations, /gap:\s*var\(--space-sm\)\s*;/);
  assert.match(declarations, /padding:\s*var\(--space-md\)\s*;/);
  assert.match(declarations, /border-top:\s*1px solid var\(--color-border\)\s*;/);
});

void test('immediate-choice ParticipationSheet keeps close while submit-based InviteSheet uses the footer contract', () => {
  assert.match(participation, /import \{ Sheet \} from '@\/ui\/Sheet';/);
  assert.match(participation, /<Sheet\b[\s\S]*title="参加の状態"/);
  assert.doesNotMatch(participation, /showCloseButton/);

  assert.match(invite, /import \{ Sheet \} from '@\/ui\/Sheet';/);
  assert.match(invite, /<Sheet\b[\s\S]*title="招待する"/);
  assert.match(invite, /showCloseButton=\{false\}/);
  assert.match(invite, /footer=\{/);
  assert.match(invite, /type="submit"[\s\S]*form=\{formId\}/);
  assert.match(invite, /id=\{formId\}/);
});
