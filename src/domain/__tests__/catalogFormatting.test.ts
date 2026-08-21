import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isRenderableHttpUrl,
  occurrenceTimeRangeLabel,
  tokyoDateLabel,
  tokyoTimeLabel,
  UNKNOWN_END_TIME_LABEL,
} from '../catalogFormatting.ts';

void test('tokyoTimeLabel: converts a UTC instant to Asia/Tokyo HH:mm', () => {
  assert.equal(tokyoTimeLabel('2026-08-10T02:00:00.000Z'), '11:00');
  assert.equal(tokyoTimeLabel('2026-08-10T15:05:00.000Z'), '00:05'); // rolls into the next Tokyo day
});

void test('tokyoDateLabel: renders a Japanese calendar date', () => {
  assert.equal(tokyoDateLabel('2026-08-10T02:00:00.000Z'), '2026年8月10日');
});

void test('occurrenceTimeRangeLabel: both times known renders a range', () => {
  assert.equal(
    occurrenceTimeRangeLabel('2026-08-10T02:00:00.000Z', '2026-08-10T05:30:00.000Z'),
    '11:00〜14:30',
  );
});

void test('occurrenceTimeRangeLabel: a null end time is labelled explicitly, never fabricated', () => {
  const label = occurrenceTimeRangeLabel('2026-08-10T02:00:00.000Z', null);
  assert.equal(label, `11:00〜（${UNKNOWN_END_TIME_LABEL}）`);
  assert.doesNotMatch(
    label,
    /\d{2}:\d{2}〜\d{2}:\d{2}/,
    'must not render as if an end time were known',
  );
});

void test('occurrenceTimeRangeLabel: an end time past midnight Tokyo is marked as the next day, not left ambiguous', () => {
  // 2026-08-10T14:00:00Z = 23:00 JST Aug 10; 2026-08-10T15:30:00Z = 00:30 JST Aug 11.
  const label = occurrenceTimeRangeLabel('2026-08-10T14:00:00.000Z', '2026-08-10T15:30:00.000Z');
  assert.equal(label, '23:00〜00:30（翌日）');
});

void test('occurrenceTimeRangeLabel: a same-day range is not marked as spanning to the next day', () => {
  const label = occurrenceTimeRangeLabel('2026-08-10T02:00:00.000Z', '2026-08-10T05:30:00.000Z');
  assert.doesNotMatch(label, /翌日/);
});

void test('isRenderableHttpUrl: accepts absolute http(s) URLs', () => {
  assert.equal(isRenderableHttpUrl('https://example.com/event'), true);
  assert.equal(isRenderableHttpUrl('http://example.com'), true);
});

void test('isRenderableHttpUrl: rejects a javascript: URL and other unsafe/invalid schemes', () => {
  assert.equal(isRenderableHttpUrl('javascript:alert(1)'), false);
  assert.equal(isRenderableHttpUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isRenderableHttpUrl('not a url at all'), false);
});
