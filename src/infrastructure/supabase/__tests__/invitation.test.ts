import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRpcError } from '../../../domain/planningError.ts';
import {
  DECLINE_ERROR_RULES,
  INVITE_BY_EMAIL_ERROR_RULES,
  INVITE_ERROR_RULES,
} from '../invitation.ts';

// Pure classification tests for invite_to_occurrence's / decline_occurrence_
// invitation's `raise exception` message rules (Issue #33, updated for
// Issue #225/#230's pending-only Invitation model). Every message tested
// here is copied verbatim from the corresponding migration's `raise
// exception '...'` text (see the RawInvitationRow-adjacent RPCs in
// supabase/migrations/20260830000000_simplify_invitation_pending_only.sql,
// which supersedes the original 20260822010200/20260822010300 versions), so
// a future re-wording of any of those messages that silently stops matching
// its rule (and falls through to a generic `failure`) fails one of these
// tests rather than going unnoticed. The real network/RPC call itself is
// exercised end-to-end in test/rls/typedBoundaryInvitation.test.ts; this
// file only pins the pure message -> PlanningErrorKind mapping.

function classifyInvite(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, INVITE_ERROR_RULES).kind;
}

function classifyDecline(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, DECLINE_ERROR_RULES).kind;
}

function classifyInviteByEmail(message: string) {
  return classifyRpcError({ message, code: 'P0001' }, INVITE_BY_EMAIL_ERROR_RULES).kind;
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

void test('invite_to_occurrence: an unrecognized message falls back to classifyPostgrestError', () => {
  assert.equal(classifyInvite('some future message this rule set does not know about'), 'failure');
});

void test('decline_occurrence_invitation: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyDecline('authentication required'), 'unauthenticated');
});

void test('decline_occurrence_invitation: "invitation is required" -> validation', () => {
  assert.equal(classifyDecline('invitation is required'), 'validation');
});

// Issue #225/#230: decline_occurrence_invitation no longer raises for "not
// found" at all - it returns `data: null` instead (see declineInvitation's
// own header in ../invitation.ts), so there is deliberately no rule/test for
// that message here anymore; a rule for it would be dead code.

void test('invite_to_occurrence_by_email: "authentication required" -> unauthenticated', () => {
  assert.equal(classifyInviteByEmail('authentication required'), 'unauthenticated');
});

void test('invite_to_occurrence_by_email: "occurrence and invitee email are required" -> validation', () => {
  assert.equal(classifyInviteByEmail('occurrence and invitee email are required'), 'validation');
});

void test('invite_to_occurrence_by_email: "invitee email is not a valid email address" -> validation', () => {
  assert.equal(classifyInviteByEmail('invitee email is not a valid email address'), 'validation');
});

void test('invite_to_occurrence_by_email: "cannot invite yourself" -> validation', () => {
  assert.equal(classifyInviteByEmail('cannot invite yourself'), 'validation');
});

void test('invite_to_occurrence_by_email: not-attending message -> permission-denied', () => {
  assert.equal(
    classifyInviteByEmail('only a user attending this occurrence can invite others to it'),
    'permission-denied',
  );
});

void test('invite_to_occurrence_by_email: an unrecognized message falls back to classifyPostgrestError', () => {
  assert.equal(
    classifyInviteByEmail('some future message this rule set does not know about'),
    'failure',
  );
});

// Deliberately no test for a "declined" or "not found" message here, unlike
// classifyInvite above: invite_to_occurrence_by_email never raises for
// anything about the invitee (see its migration's header) - a rule for
// either would be dead code that could never fire.
