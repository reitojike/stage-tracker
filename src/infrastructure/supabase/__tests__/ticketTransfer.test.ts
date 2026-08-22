import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRpcError } from '../../../domain/planningError.ts';
import { ACCEPT_ERROR_RULES, CANCEL_ERROR_RULES, REQUEST_ERROR_RULES } from '../ticketTransfer.ts';

// Pure classification tests for request_ticket_transfer's / accept_ticket_
// transfer's / cancel_ticket_transfer's `raise exception` message rules
// (Issue #33). Every message tested here is copied verbatim from
// supabase/migrations/20260822093400_create_ticket_transfer_rpcs.sql, so a
// future re-wording that silently stops matching its rule (falling through
// to a generic `failure`) fails one of these tests rather than going
// unnoticed. The real network/RPC call is exercised end-to-end in
// test/rls/typedBoundaryTransfer.test.ts; this file only pins the pure
// message -> PlanningErrorKind mapping, including branches that integration
// tests do not reach (e.g. a non-registered-user recipient, which the local
// test fixtures cannot produce without a real second auth user).

function classifyRequest(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, REQUEST_ERROR_RULES).kind;
}

function classifyAccept(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, ACCEPT_ERROR_RULES).kind;
}

function classifyCancel(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, CANCEL_ERROR_RULES).kind;
}

void test('request_ticket_transfer: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyRequest('authentication required'), 'unauthenticated');
});

void test('request_ticket_transfer: "ticket not found" -> not-found', () => {
  assert.equal(classifyRequest('ticket not found'), 'not-found');
});

void test('request_ticket_transfer: non-owner message -> permission-denied', () => {
  assert.equal(
    classifyRequest('only the current ticket owner can start a transfer'),
    'permission-denied',
  );
});

void test('request_ticket_transfer: transfer-to-self message -> validation', () => {
  assert.equal(
    classifyRequest('a ticket cannot be transferred to its current owner'),
    'validation',
  );
});

void test('request_ticket_transfer: unregistered-recipient message -> validation', () => {
  assert.equal(classifyRequest('transfer recipient is not a registered user'), 'validation');
});

void test('request_ticket_transfer: ineligible-recipient message -> validation', () => {
  assert.equal(
    classifyRequest('transfer recipient is not eligible for this occurrence'),
    'validation',
  );
});

void test('request_ticket_transfer: already-pending message -> validation', () => {
  assert.equal(classifyRequest('this ticket already has a pending transfer'), 'validation');
});

void test('accept_ticket_transfer: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyAccept('authentication required'), 'unauthenticated');
});

void test('accept_ticket_transfer: "transfer not found" -> not-found', () => {
  assert.equal(classifyAccept('transfer not found'), 'not-found');
});

void test('accept_ticket_transfer: non-recipient message -> permission-denied', () => {
  assert.equal(
    classifyAccept('only the transfer recipient can accept this transfer'),
    'permission-denied',
  );
});

void test('accept_ticket_transfer: no-longer-pending message -> validation', () => {
  assert.equal(classifyAccept('transfer is no longer pending'), 'validation');
});

void test('accept_ticket_transfer: stale-sender invariant message -> failure (unexpected, not user-facing validation)', () => {
  assert.equal(classifyAccept('transfer sender no longer owns this ticket'), 'failure');
});

void test('cancel_ticket_transfer: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyCancel('authentication required'), 'unauthenticated');
});

void test('cancel_ticket_transfer: "transfer not found" -> not-found', () => {
  assert.equal(classifyCancel('transfer not found'), 'not-found');
});

void test('cancel_ticket_transfer: non-sender message -> permission-denied', () => {
  assert.equal(
    classifyCancel('only the transfer sender can cancel this transfer'),
    'permission-denied',
  );
});

void test('cancel_ticket_transfer: no-longer-pending message -> validation', () => {
  assert.equal(classifyCancel('transfer is no longer pending'), 'validation');
});
