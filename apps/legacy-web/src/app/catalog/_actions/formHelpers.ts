// Shared helpers for the catalog feature's server actions (Issue #29,
// Issue #36). Deliberately not 'use server' - these are plain synchronous
// FormData readers, not actions themselves, and every action module that
// uses them already carries its own 'use server' directive.

/** A required identifier carried by a hidden input. Absent or non-string
 * means the request did not come from the form this action serves; it is
 * reported as a generic failure rather than being guessed at. */
export function readId(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
