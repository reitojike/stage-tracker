#!/usr/bin/env node
// Regenerates src/domain/japaneseHolidaysData.ts from the official 内閣府
// (Cabinet Office) "国民の祝日について" CSV dataset (Issue #34).
//
// Holiday authority (docs/ux-ui.md "Calendar weekday / Japanese holiday
// presentation", AGENTS.md product rules): this CSV is the *only* canonical
// source for Japanese national holidays this product renders. This script
// never invents or extrapolates a future holiday beyond what the CSV
// itself already lists - the generated snapshot's coverage is exactly
// whatever date range the fetched CSV happens to cover on the day this
// script is run.
//
// Update procedure (durable record - Acceptance Criteria "holiday update
// procedureがdurableに記録される"):
//   1. Run `node scripts/update-japanese-holidays.mjs` from the repo root.
//      It fetches the current CSV from the Cabinet Office and overwrites
//      src/domain/japaneseHolidaysData.ts.
//   2. Review the diff (in particular the trailing coverage date, which
//      moves forward as the Cabinet Office publishes further years) and
//      commit it as a normal source change.
//   3. Re-run this whenever a newly-published holiday year needs to become
//      available (the Cabinet Office typically publishes the following
//      year's holidays in the preceding year - there is no fixed schedule
//      this script can rely on, so this is a manual, as-needed operation,
//      not a scheduled job this Task introduces).
//
// The CSV is Shift_JIS-encoded and uses "YYYY/M/D,名称" rows (a header row
// first). This script normalizes dates to "YYYY-MM-DD" and fails loudly
// (non-zero exit) rather than writing a partial/malformed snapshot if the
// source ever changes shape.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCE_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv';
const SOURCE_PAGE = 'https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html';

const OUTPUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'domain',
  'japaneseHolidaysData.ts',
);

function parseDate(raw) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(raw.trim());
  if (!match) {
    throw new Error(`unexpected date cell in Cabinet Office CSV: ${JSON.stringify(raw)}`);
  }
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseCsv(text) {
  const lines = text.split(/\r\n|\n/).filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  if (header === undefined || !header.includes('月日')) {
    throw new Error('unexpected Cabinet Office CSV header - source shape may have changed');
  }
  return rows.map((line) => {
    const commaIndex = line.indexOf(',');
    if (commaIndex === -1) {
      throw new Error(`unexpected CSV row (no comma): ${JSON.stringify(line)}`);
    }
    const date = parseDate(line.slice(0, commaIndex));
    const name = line.slice(commaIndex + 1).trim();
    if (name.length === 0) {
      throw new Error(`empty holiday name for date ${date}`);
    }
    return { date, name };
  });
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`failed to fetch Cabinet Office holiday CSV: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const text = new TextDecoder('shift_jis').decode(buffer);
  const rows = parseCsv(text).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (rows.length === 0) {
    throw new Error('parsed zero holiday rows - refusing to overwrite the existing snapshot');
  }

  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  const fetchedAt = new Date().toISOString();

  const body = rows
    .map((row) => `  { date: '${row.date}', name: ${JSON.stringify(row.name)} },`)
    .join('\n');

  const output = `// GENERATED FILE - do not hand-edit.
// Produced by scripts/update-japanese-holidays.mjs from the official
// Cabinet Office (内閣府) "国民の祝日について" CSV dataset:
//   ${SOURCE_URL}
//   (published from: ${SOURCE_PAGE})
//
// Snapshot fetched: ${fetchedAt}
// Coverage: ${firstDate} .. ${lastDate} (whatever the Cabinet Office had
// published as of the fetch above - unpublished future holidays are never
// guessed; see scripts/update-japanese-holidays.mjs and docs/holiday-data.md
// for the update procedure).

export interface JapaneseHolidayRow {
  /** Asia/Tokyo calendar date, "YYYY-MM-DD". */
  date: string;
  /** Official Japanese name, verbatim from the Cabinet Office CSV. */
  name: string;
}

export const JAPANESE_HOLIDAY_DATA_SOURCE_URL = '${SOURCE_URL}';
export const JAPANESE_HOLIDAY_DATA_FETCHED_AT = '${fetchedAt}';
export const JAPANESE_HOLIDAY_DATA_COVERAGE_START = '${firstDate}';
export const JAPANESE_HOLIDAY_DATA_COVERAGE_END = '${lastDate}';

export const JAPANESE_HOLIDAY_DATA: readonly JapaneseHolidayRow[] = [
${body}
];
`;

  await writeFile(OUTPUT_PATH, output, 'utf8');
  console.log(`Wrote ${rows.length} holiday rows (${firstDate} .. ${lastDate}) to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
