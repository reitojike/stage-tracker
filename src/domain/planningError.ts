// Shared error/result vocabulary for the MVP personal planning typed
// read/write boundary (Issue #33): participation, invitation, personal
// schedule, ticket acquisition, ticket, and ticket transfer all report
// outcomes through this same shape, so a UI-facing caller branches on one
// consistent set of error kinds instead of a different ad-hoc shape per
// feature. This module is pure domain logic: no Supabase import (see the
// architecture import boundary in eslint.config.mjs).
//
// This is deliberately narrower than a generic error framework: it only
// names the outcomes docs/ux-ui.md and Issue #33 require a UI be able to
// distinguish. Anything finer-grained than that (e.g. *why* a validation
// failed) stays in `message`, not in a new `kind`.

export type PlanningErrorKind =
  'unauthenticated' | 'not-found' | 'permission-denied' | 'validation' | 'failure';

export interface PlanningError {
  kind: PlanningErrorKind;
  message: string;
  code: string;
}

/**
 * Discriminated success/error result. `data` on the `ok: true` branch may
 * legitimately be `null`/an empty array - that is a valid empty result, not
 * an error. Every typed feature-level operation in src/infrastructure/
 * supabase/ returns this shape (or PlanningResult<void>), never a raw
 * Supabase/Postgrest error.
 */
export type PlanningResult<T> = { ok: true; data: T } | { ok: false; error: PlanningError };

/** The minimal shape of a Postgrest/Supabase query error this module maps
 * from - narrowed the same way domain/eventCatalog.ts's RawPostgrestError
 * narrows it, rather than importing PostgrestError from the Supabase SDK. */
export interface RawPostgrestError {
  message: string;
  code: string;
}

/** insufficient_privilege: raised by RLS/grant denials (e.g. a column with
 * no grant, or a WITH CHECK failure surfaced as an error rather than as an
 * empty affected-rows result). */
const INSUFFICIENT_PRIVILEGE = '42501';

/** Constraint and data-format violations the database rejects: NOT NULL,
 * foreign key, unique, CHECK, and invalid datetime/text input. These mean
 * the submitted values are wrong, not that the caller lacked permission. */
const VALIDATION_CODES = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  '22007', // invalid_datetime_format
  '22008', // datetime_field_overflow
  '22P02', // invalid_text_representation
]);

/**
 * Classifies a plain Postgrest/table-level error by its SQLSTATE. This is
 * the fallback every RPC-specific classifier below falls through to, and
 * the only classifier plain `.from(...)` table operations need - the codes
 * above are Postgres-assigned, not this project's own text, so matching on
 * them is exact rather than fragile.
 */
export function classifyPostgrestError(error: RawPostgrestError): PlanningError {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return { kind: 'permission-denied', message: error.message, code: error.code };
  }
  if (VALIDATION_CODES.has(error.code)) {
    return { kind: 'validation', message: error.message, code: error.code };
  }
  return { kind: 'failure', message: error.message, code: error.code };
}

export interface RpcErrorRule {
  test: (message: string) => boolean;
  kind: PlanningErrorKind;
}

/**
 * Classifies an error raised by one of this Task's own SECURITY DEFINER
 * RPCs (request_ticket_transfer, accept_ticket_transfer,
 * cancel_ticket_transfer, invite_to_occurrence,
 * decline_occurrence_invitation - see supabase/migrations/). Every `raise
 * exception` in those functions shares Postgres's default P0001 SQLSTATE
 * (none of them attach `using errcode`), so the SQLSTATE alone cannot tell
 * "not found" apart from "not eligible" apart from "already settled" the
 * way classifyPostgrestError tells permission apart from validation.
 *
 * The message text tested here is this project's own migration source, not
 * an external or opaque string - matching against it is matching a contract
 * this codebase owns and keeps in sync (each call site cites the exact
 * `raise exception` line it maps), not guessing at third-party wording.
 *
 * `rules` is checked in order; the first match wins. Anything matching none
 * of them, or arriving with a non-P0001 SQLSTATE (e.g. a genuine 42501 from
 * an EXECUTE grant being revoked), falls back to classifyPostgrestError.
 */
export function classifyRpcError(
  error: RawPostgrestError,
  rules: readonly RpcErrorRule[],
): PlanningError {
  for (const rule of rules) {
    if (rule.test(error.message)) {
      return { kind: rule.kind, message: error.message, code: error.code };
    }
  }
  return classifyPostgrestError(error);
}
