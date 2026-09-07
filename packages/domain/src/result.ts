/**
 * A minimal `Result` type for pure functions that can fail without throwing.
 *
 * This package is pure (no I/O, no clock access) and prefers returning
 * failures as values over throwing, mirroring the `{ok:true,value}|{ok:false,error}`
 * convention already used by the current app's parse layer
 * (see docs/v2/oracle-domain.md §3.6).
 */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
