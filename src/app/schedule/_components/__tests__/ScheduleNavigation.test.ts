import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const configPath = fileURLToPath(new URL('../../../../../next.config.ts', import.meta.url));
const retiredPagePath = fileURLToPath(new URL('../../page.tsx', import.meta.url));
const detailPath = fileURLToPath(new URL('../../[entryId]/page.tsx', import.meta.url));
const editPath = fileURLToPath(new URL('../../[entryId]/edit/page.tsx', import.meta.url));
const newPath = fileURLToPath(new URL('../../new/page.tsx', import.meta.url));
const actionPath = fileURLToPath(new URL('../../_actions/scheduleWrite.ts', import.meta.url));
const myPagePath = fileURLToPath(
  new URL('../../../mypage/_components/ScheduleAndEventSection.tsx', import.meta.url),
);
const calendarRowPath = fileURLToPath(
  new URL('../../../calendar/_components/MyCalendarEntryRow.tsx', import.meta.url),
);

void test('bare /schedule is a compatibility redirect and no longer renders the retired list', () => {
  const source = readFileSync(configPath, 'utf8');
  assert.match(source, /source: ["']\/schedule["'], destination: ["']\/calendar["']/);
  assert.match(source, /permanent: false/);
  assert.equal(existsSync(retiredPagePath), false);
});

void test('schedule detail and edit keep bounded month context through their round-trip', () => {
  const detail = readFileSync(detailPath, 'utf8');
  const edit = readFileSync(editPath, 'utf8');
  assert.match(detail, /searchParams: Promise<Record<string, string \| string\[\] \| undefined>>/);
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

void test('schedule writes land on My Calendar while owner sharing stays on detail', () => {
  const source = readFileSync(actionPath, 'utf8');
  assert.doesNotMatch(source, /redirect\(['"`]\/schedule['"`]\)/);
  assert.match(source, /redirect\(["']\/calendar["']\)/);
  assert.match(source, /revalidatePath\(["']\/calendar["']\)/);
  assert.match(source, /revalidatePath\(`\/schedule\/\$\{entryId\}`\)/);
  assert.match(source, /return acceptedShareAddFormState\(previous\)/);
  assert.match(source, /return \{ attempt: previous\.attempt \+ 1, feedback: null \}/);
});

void test('My Calendar schedule rows carry the displayed month into detail', () => {
  const source = readFileSync(calendarRowPath, 'utf8');
  assert.match(source, /scheduleEntryHref\(entry\.id, eventDetailContext\.yearMonth\)/);
});

void test('My Page no longer exposes the retired schedule-management row', () => {
  const source = readFileSync(myPagePath, 'utf8');
  assert.doesNotMatch(source, /個人予定を管理|PERSONAL_SCHEDULE_HREF|href="\/schedule"/);
  assert.match(source, /catalogInvitationsHref\(\)/);
  assert.match(source, /pendingInvitationCount > 0/);
  assert.match(source, /canCreateEvent \?/);
});
