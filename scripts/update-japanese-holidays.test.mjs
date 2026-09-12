import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { formatHolidaySnapshot, OUTPUT_PATH } from './update-japanese-holidays.mjs';

test('holiday updater targets the current app canonical snapshot without fetching', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  assert.equal(
    path.relative(repositoryRoot, OUTPUT_PATH).replaceAll(path.sep, '/'),
    'apps/web/src/app/_lib/japanese-holidays-data.ts',
  );
});

test('holiday updater emits the current canonical file in its Prettier format without fetching', async () => {
  const output = await formatHolidaySnapshot(
    [{ date: '2027-01-01', name: '元日' }],
    '2026-09-12T00:00:00.000Z',
  );
  const prettierConfig = await prettier.resolveConfig(OUTPUT_PATH);

  assert.equal(await prettier.check(output, { ...prettierConfig, filepath: OUTPUT_PATH }), true);
  assert.match(output, /date: "2027-01-01", name: "元日"/);
  assert.match(output, /JAPANESE_HOLIDAY_DATA_SOURCE_URL =\n  "https:\/\/www8\.cao\.go\.jp/);
});
