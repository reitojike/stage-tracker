import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  scheduleEntryBackHref,
  scheduleEntryDetailHref,
  scheduleEntryEditHref,
  scheduleEntryHref,
  scheduleNewBackHref,
} from '../myCalendarNavigation.ts';

void test('scheduleEntryHref binds the displayed My Calendar month, not entry timing', () => {
  assert.equal(scheduleEntryHref('carry-in', '2026-09'), '/schedule/carry-in?month=2026-09');
});

void test('schedule detail back href accepts only a valid bounded month', () => {
  assert.equal(scheduleEntryBackHref('2026-09'), '/calendar?month=2026-09');
  assert.equal(scheduleEntryBackHref(['2026-09', '2026-10']), '/calendar?month=2026-09');
  assert.equal(scheduleEntryBackHref('2026-13'), '/calendar');
  assert.equal(scheduleEntryBackHref(undefined), '/calendar');
});

void test('detail and edit hrefs preserve valid month context without trusting arbitrary URLs', () => {
  assert.equal(scheduleEntryDetailHref('entry-1', '2026-09'), '/schedule/entry-1?month=2026-09');
  assert.equal(scheduleEntryDetailHref('entry-1', 'https://example.test'), '/schedule/entry-1');
  assert.equal(scheduleEntryEditHref('entry-1', '2026-09'), '/schedule/entry-1/edit?month=2026-09');
  assert.equal(scheduleEntryEditHref('entry-1', undefined), '/schedule/entry-1/edit');
});

void test('new-screen back href derives a month only from a valid selected date', () => {
  assert.equal(scheduleNewBackHref('2026-09-21'), '/calendar?month=2026-09');
  assert.equal(scheduleNewBackHref('2026-02-30'), '/calendar');
  assert.equal(scheduleNewBackHref(undefined), '/calendar');
});
