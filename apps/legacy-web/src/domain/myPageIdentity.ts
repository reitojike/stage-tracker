/**
 * AppBar avatar initial (Issue #159). Pure presentation derivation - no
 * identity lookup happens here, callers hand in whatever email they already
 * resolved (see src/infrastructure/supabase/session.ts's
 * resolveMyPageAppBarIdentity). `Array.from(email)` rather than `email[0]`
 * so a leading multi-byte character (surrogate pair) isn't split in half.
 */
export function resolveMyPageInitial(email: string | null): string | undefined {
  if (email === null || email.length === 0) {
    return undefined;
  }
  return Array.from(email)[0]?.toUpperCase();
}
