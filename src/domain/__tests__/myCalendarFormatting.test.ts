import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  participationStatusLabel,
  ticketDisplayStatusBadgeVariant,
  ticketDisplayStatusLabel,
} from '../myCalendarFormatting.ts';

// Issue #138: ticketDisplayStatusBadgeVariant maps every TicketDisplayStatus
// onto one of the 4 redefined Badge variants (outline/subtle/deadline/
// terminal). Labels themselves are untouched by #138 and are covered here
// only to pin the existing pairing each status renders with.

void test('ticketDisplayStatusBadgeVariant maps secured to subtle (in-progress/confirmed state)', () => {
  assert.equal(ticketDisplayStatusBadgeVariant('secured'), 'subtle');
});

void test('ticketDisplayStatusBadgeVariant maps pending to subtle (in-progress state)', () => {
  assert.equal(ticketDisplayStatusBadgeVariant('pending'), 'subtle');
});

void test('ticketDisplayStatusBadgeVariant maps unsuccessful to terminal (no further action possible)', () => {
  assert.equal(ticketDisplayStatusBadgeVariant('unsuccessful'), 'terminal');
});

void test('ticketDisplayStatusBadgeVariant maps none to outline (classification, not yet attempted)', () => {
  assert.equal(ticketDisplayStatusBadgeVariant('none'), 'outline');
});

void test('ticketDisplayStatusLabel text is unchanged by the #138 variant remap', () => {
  assert.equal(ticketDisplayStatusLabel('secured'), 'チケット確保済み');
  assert.equal(ticketDisplayStatusLabel('pending'), 'チケット申込中（未確定）');
  assert.equal(ticketDisplayStatusLabel('unsuccessful'), 'チケット落選/不成立');
  assert.equal(ticketDisplayStatusLabel('none'), 'チケット未取得（未確定）');
});

void test('participationStatusLabel is unaffected by the Badge variant remap', () => {
  assert.equal(participationStatusLabel('attending'), '参加する');
  assert.equal(participationStatusLabel('considering'), '気になる');
});
