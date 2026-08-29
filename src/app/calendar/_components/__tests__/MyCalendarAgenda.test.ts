import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const agendaPath = fileURLToPath(new URL('../MyCalendarAgenda.tsx', import.meta.url));
const pagePath = fileURLToPath(new URL('../../page.tsx', import.meta.url));

void test('month agenda uses the shared date-role authority and row presenter', () => {
  const source = readFileSync(agendaPath, 'utf8');
  assert.match(source, /import \{ DayRoleText \} from '@\/ui\/DayRoleText'/);
  assert.match(source, /calendarDateAccessibleWeekdayLabel/);
  assert.match(source, /calendarDateWeekdayLabel/);
  assert.match(source, /calendarDayRole/);
  assert.match(source, /<MyCalendarEntryRow/);
  assert.match(source, /eventDetailContext=\{\{ yearMonth, selectedDate: group\.date \}\}/);
  assert.doesNotMatch(source, /予定を追加|scheduleNewHrefForDate/);
});

void test('month agenda row keys include source kind and logical id for deterministic identity', () => {
  const source = readFileSync(agendaPath, 'utf8');
  assert.match(source, /key=\{`\$\{item\.kind\}-\$\{itemId\(item\)\}`\}/);
  assert.match(source, /data-agenda-date=\{group\.date\}/);
  assert.match(source, /data-agenda-item-kind=\{item\.kind\}/);
});

void test('page switches between month agenda and selected-day detail on selectedDate', () => {
  const source = readFileSync(pagePath, 'utf8');
  assert.match(source, /buildMyCalendarMonthAgenda\(/);
  const monthLandingStart = source.indexOf('{selectedDate === null ? (');
  const monthAgendaStart = source.indexOf('<MyCalendarAgenda', monthLandingStart);
  const selectedDayStart = source.indexOf('{selectedDate !== null ? (');
  const selectedDayListStart = source.indexOf('<MySelectedDayList', selectedDayStart);
  assert.notEqual(monthLandingStart, -1);
  assert.notEqual(monthAgendaStart, -1);
  assert.notEqual(selectedDayStart, -1);
  assert.notEqual(selectedDayListStart, -1);
  assert.ok(monthAgendaStart > monthLandingStart);
  assert.ok(selectedDayListStart > selectedDayStart);
});
