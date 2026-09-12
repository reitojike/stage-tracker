import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OUTPUT_PATH } from './update-japanese-holidays.mjs';

test('holiday updater targets the current app canonical snapshot without fetching', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  assert.equal(
    path.relative(repositoryRoot, OUTPUT_PATH).replaceAll(path.sep, '/'),
    'apps/web/src/app/_lib/japanese-holidays-data.ts',
  );
});
