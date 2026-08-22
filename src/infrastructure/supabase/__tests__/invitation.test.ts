import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRpcError } from '../../../domain/planningError.ts';
import { DECLINE_ERROR_RULES, INVITE_ERROR_RULES } from '../invitation.ts';

// Pure classification tests for invite_to_occurrence's / decline_occurrence_
// invitation's `raise exception` message rules (Issue #33). Every message
// tested here is copied verbatim from the corresponding migration's `raise
// exception '...'` text (see the RawInvitationRow-adjacent RPCs in
// supabase/migrations/20260822010200_create_invite_to_occurrence_rpc.sql and
// 20260822010300_create_decline_occurrence_invitation_rpc.sql), so a future
// re-wording of any of those messages that silently stops matching its rule
// (and falls through to a generic `failure`) fails one of these tests rather
// than going unnoticed. The real network/RPC call itself is exercised
// end-to-end in test/rls/typedBoundaryInvitation.test.ts; this file only
// pins the pure message -> PlanningErrorKind mapping.

function classifyInvite(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, INVITE_ERROR_RULES).kind;
}

function classifyDecline(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, DECLINE_ERROR_RULES).kind;
}

void test('invite_to_occurrence: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyInvite('authentication required'), 'unauthenticated');
});

void test('invite_to_occurrence: "occurrence and invitee are required" -> validation', () => {
  assert.equal(classifyInvite('occurrence and invitee are required'), 'validation');
});

void test('invite_to_occurrence: "cannot invite yourself" -> validation', () => {
  assert.equal(classifyInvite('cannot invite yourself'), 'validation');
});

void test('invite_to_occurrence: not-attending message -> permission-denied', () => {
  assert.equal(
    classifyInvite('only a user attending this occurrence can invite others to it'),
    'permission-denied',
  );
});

void test('invite_to_occurrence: re-invite-after-decline message -> validation', () => {
  assert.equal(
    classifyInvite('this invitation was declined; re-inviting is not a supported operation'),
    'validation',
  );
});

void test('invite_to_occurrence: an unrecognized message falls back to classifyPostgrestError', () => {
  assert.equal(classifyInvite('some future message this rule set does not know about'), 'failure');
});

void test('decline_occurrence_invitation: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyDecline('authentication required'), 'unauthenticated');
});

void test('decline_occurrence_invitation: "invitation is required" -> validation', () => {
  assert.equal(classifyDecline('invitation is required'), 'validation');
});

void test('decline_occurrence_invitation: "invitation not found" -> not-found', () => {
  assert.equal(classifyDecline('invitation not found'), 'not-found');
});
