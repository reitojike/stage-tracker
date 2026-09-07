// Invitee email parsing for the invite-by-email UI journey (Issue #36).
//
// product decision (Issue #36 PO checkpoint, 2026-08-23): MVP invitee
// selection is exact registered email input - no user directory/search, no
// UUID input. This module owns only format validation; whether the email
// actually resolves to an account is decided server-side by
// public.invite_to_occurrence_by_email (supabase/migrations/
// 20260823000000_create_invite_to_occurrence_by_email_rpc.sql) and is
// deliberately never reported back to this client (opacity requirement -
// see that migration's header). This regex mirrors the shape of the one
// enforced there closely enough that the two agree on realistic input, but
// they are not byte-for-byte equivalent - JS's `\s` and Postgres's
// `[:space:]` do not necessarily cover identical Unicode whitespace sets -
// so this function's rejection is UX only; the RPC's own check is the only
// one that actually enforces the format, and is authoritative if the two
// ever disagree on an edge case.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs).

const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ParseInviteeEmailResult =
  { ok: true; email: string } | { ok: false; fieldError: string };

/** Trims and lowercases before validating, matching the normalization the
 * RPC performs on its own side (lower(btrim(...))) so what this validates
 * is exactly what gets sent. */
export function parseInviteeEmail(raw: string): ParseInviteeEmailResult {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '') {
    return { ok: false, fieldError: 'メールアドレスを入力してください。' };
  }
  if (!EMAIL_FORMAT.test(trimmed)) {
    return { ok: false, fieldError: 'メールアドレスの形式が正しくありません。' };
  }
  return { ok: true, email: trimmed };
}
