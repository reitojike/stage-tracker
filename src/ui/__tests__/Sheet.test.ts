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

void test('renders the shared header while allowing FilterSheet to keep its footer-only affordance', () => {
  assert.match(component, /<div className=\{styles\.header\}>/);
  assert.match(component, /<p id=\{titleId\} className=\{styles\.title\}>/);
  assert.match(component, /showCloseButton = true/);
  assert.match(component, /\{showCloseButton \? \(/);
  assert.match(component, />\s*閉じる\s*<\/Button>/);
});

void test('renders the optional footer outside the scrollable body', () => {
  const bodyAndFooter = component.match(
    /<div className=\{\[styles\.body, bodyClassName\][\s\S]*?<\/div>\s*\{footer\}/,
  );
  assert.ok(bodyAndFooter, 'footer must follow the body instead of being nested in it');
  assert.match(component, /bodyClassName\?: string/);
  assert.match(component, /footer\?: ReactNode/);
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

void test('ParticipationSheet and InviteSheet retain the default shared close behavior', () => {
  assert.match(participation, /import \{ Sheet \} from '@\/ui\/Sheet';/);
  assert.match(participation, /<Sheet\b[\s\S]*title="参加の状態"/);
  assert.doesNotMatch(participation, /showCloseButton/);

  assert.match(invite, /import \{ Sheet \} from '@\/ui\/Sheet';/);
  assert.match(invite, /<Sheet\b[\s\S]*title="招待する"/);
  assert.doesNotMatch(invite, /showCloseButton/);
});
