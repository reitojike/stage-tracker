import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const detailPath = fileURLToPath(new URL('../../[entryId]/page.tsx', import.meta.url));
const editPath = fileURLToPath(new URL('../../[entryId]/edit/page.tsx', import.meta.url));
const newPath = fileURLToPath(new URL('../../new/page.tsx', import.meta.url));
const actionPath = fileURLToPath(new URL('../../_actions/scheduleWrite.ts', import.meta.url));
const calendarRowPath = fileURLToPath(
  new URL('../../../calendar/_components/MyCalendarEntryRow.tsx', import.meta.url),
);

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf(`export async function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

void test('schedule detail and edit wire bounded month context through their round-trip', () => {
  const detail = readFileSync(detailPath, 'utf8');
  const edit = readFileSync(editPath, 'utf8');
  assert.match(detail, /scheduleEntryBackHref\(rawSearchParams\.month\)/);
  assert.match(detail, /<BackLink href=\{backHref\}>マイカレンダーに戻る<\/BackLink>/);
  assert.match(detail, /scheduleEntryEditHref\(entryId, rawSearchParams\.month\)/);
  assert.match(edit, /scheduleEntryDetailHref\(entryId, rawSearchParams\.month\)/);
  assert.match(edit, /<BackLink href=\{detailHref\}>予定に戻る<\/BackLink>/);
});

void test('new schedule keeps selected-date prefill and returns to the calendar', () => {
  const source = readFileSync(newPath, 'utf8');
  assert.match(source, /resolveScheduleCreatePrefill\(rawParams\)/);
  assert.match(source, /scheduleNewBackHref\(rawParams\.date\)/);
  assert.match(source, /<BackLink href=\{backHref\}>マイカレンダーに戻る<\/BackLink>/);
});

void test('schedule writes use the correct landing for each action', () => {
  const source = readFileSync(actionPath, 'utf8');
  const calendarLandingActions = [
    'createScheduleEntryAction',
    'updateScheduleEntryAction',
    'deleteScheduleEntryAction',
    'removeScheduleShareAction',
  ];
  for (const functionName of calendarLandingActions) {
    assert.match(
      functionBody(source, functionName),
      /redirect\(["']\/calendar["']\)/,
      `${functionName} should land on My Calendar`,
    );
  }

  const ownerAdd = functionBody(source, 'addScheduleShareByEmailAction');
  const ownerRemove = functionBody(source, 'removeScheduleShareAsOwnerAction');
  assert.doesNotMatch(ownerAdd, /redirect\(/);
  assert.doesNotMatch(ownerRemove, /redirect\(/);
  assert.match(ownerAdd, /revalidatePath\(`\/schedule\/\$\{entryId\}`\)/);
  assert.match(ownerRemove, /revalidatePath\(`\/schedule\/\$\{entryId\}`\)/);
  assert.match(ownerAdd, /return acceptedShareAddFormState\(previous\)/);
  assert.match(ownerRemove, /return \{ attempt: previous\.attempt \+ 1, feedback: null \}/);
});

void test('My Calendar schedule rows carry the displayed month into detail', () => {
  const source = readFileSync(calendarRowPath, 'utf8');
  assert.match(source, /scheduleEntryHref\(entry\.id, eventDetailContext\.yearMonth\)/);
});
