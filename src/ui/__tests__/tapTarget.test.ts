import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composesRole, readCss, ruleBody } from './sharedRoleWiring.ts';

/*
 * The shared 44px tap-target expansion.
 *
 * WCAG 2.2 SC 2.5.8 is the rule here, not an implementation preference: a
 * control's visible fill may be smaller than 44px, its tap target may not.
 * Losing this composition is invisible on screen - the control looks
 * exactly the same - and only shows up as a control that is hard to hit,
 * which is why it is worth wiring rather than leaving to review.
 *
 * Added by the PR #342 review: the first pass of Issue #312 wired five
 * authorities and dropped this one silently, so deleting BackLink's
 * `composes` left a 27px control with a 27px tap target and every test
 * still green.
 */

const AUTHORITY = 'tapTarget.module.css';
const shared = readCss('src/ui/tapTarget.module.css');

void test('the shared expansion centres a 44px minimum on the composing element', () => {
  // position: relative on the composing element is what the ::before
  // centres against; without it the pseudo-element resolves against some
  // further-out ancestor.
  assert.match(ruleBody(shared, '.expand44') ?? '', /position:\s*relative;/);

  const pseudo = ruleBody(shared, '.expand44::before') ?? '';
  assert.match(pseudo, /width:\s*max\(100%,\s*44px\);/);
  assert.match(pseudo, /height:\s*max\(100%,\s*44px\);/);
  assert.match(pseudo, /position:\s*absolute;/);
});

/*
 * Required composition wiring: every control whose visible fill is allowed
 * to be smaller than 44px. Adding a sixth means adding a row here.
 */
const wiring = [
  ['src/ui/Button.module.css', 'button'],
  ['src/ui/BackLink.module.css', 'backLink'],
  ['src/app/catalog/_components/CatalogView.module.css', 'summaryClear'],
  ['src/app/catalog/_components/EventDetail.module.css', 'editLink'],
  ['src/app/catalog/_components/InvitationCard.module.css', 'undoButton'],
] as const;

void test('every control with a sub-44px fill composes the shared expansion', () => {
  for (const [relativePath, className] of wiring) {
    assert.ok(
      composesRole(readCss(relativePath), className, 'expand44', AUTHORITY),
      `${relativePath} .${className} must compose expand44 from ${AUTHORITY} (WCAG 2.2 SC 2.5.8)`,
    );
  }
});
