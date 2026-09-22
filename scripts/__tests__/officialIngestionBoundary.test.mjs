import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Linter } from 'eslint';
import { noPrivilegedIngestionImport } from '../../apps/web/eslint/official-ingestion-boundary.mjs';

function lint(source, filename) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    source,
    [
      {
        files: ['**/*.ts'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        plugins: {
          boundary: { rules: { 'no-privileged-import': noPrivilegedIngestionImport } },
        },
        rules: { 'boundary/no-privileged-import': 'error' },
      },
    ],
    { filename },
  );
}

describe('privileged official ingestion import boundary', () => {
  test('rejects static and dynamic imports from ordinary app surfaces', () => {
    for (const source of [
      'import { createPrivilegedIngestionClient } from "@/workflows/official-import/privileged/supabase";',
      'export * from "../../workflows/official-import/privileged/staging-repository";',
      'void import("@/workflows/official-import/privileged/supabase");',
    ]) {
      const messages = lint(source, 'src/app/example/route.ts');
      assert.equal(messages.length, 1);
      assert.equal(messages[0].ruleId, 'boundary/no-privileged-import');
    }
  });

  test('allows the same import from the workflow-owned boundary', () => {
    const messages = lint(
      'import { createPrivilegedIngestionClient } from "@/workflows/official-import/privileged/supabase";',
      'src/workflows/official-import/steps/example.ts',
    );
    assert.deepEqual(messages, []);
  });
});
