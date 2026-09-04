import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const sharedCss = readFileSync(
  fileURLToPath(new URL('../visuallyHidden.module.css', import.meta.url)),
  'utf8',
);

const consumerCss = [
  '../TriStateCheckbox.module.css',
  '../../app/schedule/_components/ScheduleWriteForm.module.css',
  '../../app/catalog/_components/FilterSheet.module.css',
  '../../app/tickets/_components/TicketOpportunityRow.module.css',
  '../WriteNotice.module.css',
  '../../app/catalog/_components/EventWriteForm.module.css',
].map((relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
);

void test('keeps the full visually-hidden contract centralized and focusable', () => {
  const fullRule = sharedCss.match(/\.visuallyHidden\s*\{([^}]*)\}/);
  assert.ok(fullRule, 'full visually-hidden rule is missing');
  assert.match(fullRule[1] ?? '', /position:\s*absolute;/);
  assert.match(fullRule[1] ?? '', /width:\s*1px;/);
  assert.match(fullRule[1] ?? '', /height:\s*1px;/);
  assert.match(fullRule[1] ?? '', /overflow:\s*hidden;/);
  assert.match(fullRule[1] ?? '', /clip-path:\s*inset\(50%\);/);
  assert.match(fullRule[1] ?? '', /white-space:\s*nowrap;/);
  assert.match(fullRule[1] ?? '', /border:\s*0;/);
  assert.doesNotMatch(fullRule[1] ?? '', /display:\s*none/);
});

void test('keeps a separate minimal contract for empty live-region shells', () => {
  const minimalRule = sharedCss.match(/\.visuallyHiddenRegion\s*\{([^}]*)\}/);
  assert.ok(minimalRule, 'minimal visually-hidden rule is missing');
  assert.match(minimalRule[1] ?? '', /position:\s*absolute;/);
  assert.match(minimalRule[1] ?? '', /clip-path:\s*inset\(50%\);/);
  assert.doesNotMatch(minimalRule[1] ?? '', /white-space|border:|padding:|margin:/);
});

void test('all six existing consumers compose one of the two shared contracts', () => {
  const compositions = consumerCss.flatMap(
    (css) =>
      css.match(
        /composes:\s*visuallyHidden(?:Region)?\s+from\s+['"][^'"]+visuallyHidden\.module\.css['"];?/g,
      ) ?? [],
  );
  assert.equal(compositions.length, 6);
  assert.equal(
    compositions.filter((composition) => composition.includes('visuallyHiddenRegion')).length,
    2,
  );
  assert.equal(
    compositions.filter((composition) => /^composes:\s*visuallyHidden\s/.test(composition)).length,
    4,
  );
  assert.doesNotMatch(consumerCss.join('\n'), /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
});
