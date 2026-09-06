import assert from 'node:assert/strict';
import { test } from 'node:test';

import { composesRole, readCss } from './sharedRoleWiring.ts';

/*
 * Issue #356. TextArea.module.css composes six shared presentation roles
 * from TextInput.module.css (field/label/control/controlError/helperText/
 * errorText) instead of restating them, so the two controls cannot drift
 * apart as tokens change (see TextArea.module.css's own header comment).
 *
 * That wiring is the whole guarantee: a `composes:` line lost while the
 * class's own rule (e.g. TextArea's `resize: vertical` on `.control`) stays
 * behind reads as a perfectly reasonable stylesheet. This is a structural
 * wiring test only - it does not re-verify TextInput's or TextArea's
 * rendered behaviour, which belongs to browser-driven tests elsewhere.
 */

const AUTHORITY = 'TextInput.module.css';
const textAreaCss = readCss('src/ui/TextArea.module.css');

/**
 * Required composition wiring: TextArea's local class name paired with the
 * TextInput role it must compose. `control`/`controlError` map to
 * TextInput's `input`/`inputError` - TextArea's own vocabulary for the
 * control itself, since it also carries a local `resize: vertical`
 * declaration.
 */
const WIRING = [
  ['field', 'field'],
  ['label', 'label'],
  ['control', 'input'],
  ['controlError', 'inputError'],
  ['helperText', 'helperText'],
  ['errorText', 'errorText'],
] as const;

void test('TextArea composes all six shared roles from TextInput rather than restating them', () => {
  for (const [className, role] of WIRING) {
    assert.ok(
      composesRole(textAreaCss, className, role, AUTHORITY),
      `TextArea.module.css .${className} must compose ${role} from ${AUTHORITY}`,
    );
  }
});
