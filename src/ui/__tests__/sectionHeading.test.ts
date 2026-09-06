import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { composesRole, readCss as readRepoCss } from './sharedRoleWiring.ts';

/*
 * Issue #309. The "太罫見出し" bold rule under a section heading had drifted
 * into five independent copies with three different padding-bottom values
 * (4px / 14px / 16px), one of them (EventWriteForm) also a different
 * border color for the danger variant. This file owns the shared module's
 * own border/spacing contract and the required composition wiring - the
 * only thing standing between a dropped `composes:` line and a heading
 * silently losing its rule or reverting to a stale padding value.
 *
 * `.rule` (border-bottom + padding-bottom only) and `.heading` (`.rule`
 * plus this repo's section-heading typography) are separate composable
 * classes on purpose: SchedulePageHeading and EventWriteForm's
 * `.sectionHeading` compose only `.rule` because forcing the shared
 * typography onto them would change a page-level heading's type scale or
 * bold an unrelated sibling that has no font-weight of its own - see the
 * comments at each of those call sites.
 */

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** Declarations only: the shared module's own comment quotes selectors of its own. */
const readCss = (relativePath: string) => read(relativePath).replace(/\/\*[\s\S]*?\*\//g, '');

const sharedCss = readCss('../sectionHeading.module.css');

/** The declaration body of a top-level rule, which always starts a line. */
const ruleBody = (css: string, selector: string): string => {
  const match = css.match(new RegExp(`(?:^|\\n)\\.${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `.${selector} rule is missing`);
  return match[1] ?? '';
};

void test('the shared rule owns the border and the single padding-bottom value', () => {
  const rule = ruleBody(sharedCss, 'rule');
  assert.match(rule, /border-bottom:\s*2px solid var\(--color-text\);/);
  assert.match(rule, /padding-bottom:\s*var\(--space-card-block\);/);
  // One value, not one per consumer.
  assert.equal((sharedCss.match(/padding-bottom:/g) ?? []).length, 1);
  assert.equal((sharedCss.match(/border-bottom:\s*2px solid/g) ?? []).length, 1);
});

void test('heading composes rule and adds the section-heading (title-role) typography', () => {
  assert.match(ruleBody(sharedCss, 'heading'), /composes:\s*rule;/);
  const heading = ruleBody(sharedCss, 'heading');
  assert.match(heading, /font-size:\s*var\(--font-size-body\);/);
  assert.match(heading, /font-weight:\s*var\(--font-weight-semibold\);/);
});

/*
 * Required composition wiring: every current call site of the bold rule.
 * `rule` sites keep their own typography deliberately (see file header);
 * `heading` sites rely on the shared class for both the border and the
 * type scale.
 */
const wiring = [
  ['src/app/(home)/page.module.css', 'blockHeading', 'heading'],
  ['src/app/(home)/page.module.css', 'deadlineHeadingRow', 'heading'],
  ['src/app/catalog/_components/EventDetail.module.css', 'titleRow', 'heading'],
  ['src/app/catalog/_components/EventDetail.module.css', 'occurrenceHeading', 'heading'],
  ['src/app/catalog/_components/InvitationList.module.css', 'headingRow', 'heading'],
  ['src/app/catalog/_components/EventWriteForm.module.css', 'sectionHeading', 'rule'],
  ['src/app/mypage/_components/AccountSection.module.css', 'heading', 'heading'],
  ['src/app/mypage/_components/PasskeySection.module.css', 'heading', 'heading'],
  ['src/app/mypage/_components/ScheduleAndEventSection.module.css', 'heading', 'heading'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', 'titleRow', 'heading'],
  ['src/app/schedule/_components/ScheduleDetail.module.css', 'dangerHeading', 'heading'],
  ['src/app/schedule/_components/SchedulePageHeading.module.css', 'heading', 'rule'],
] as const;

void test('every current section/page heading composes the shared authority', () => {
  for (const [relativePath, className, role] of wiring) {
    assert.ok(
      composesRole(readRepoCss(relativePath), className, role, 'sectionHeading.module.css'),
      `${relativePath} .${className} must compose ${role} from sectionHeading.module.css`,
    );
  }
});

void test('the danger heading overrides only color, not the border-bottom value', () => {
  const dangerCss = readRepoCss('src/app/schedule/_components/ScheduleDetail.module.css');
  const dangerRule = ruleBody(dangerCss, 'dangerHeading');
  assert.match(dangerRule, /border-color:\s*var\(--color-danger\);/);
  assert.match(dangerRule, /color:\s*var\(--color-danger\);/);
  assert.doesNotMatch(dangerRule, /padding-bottom:/);
});
