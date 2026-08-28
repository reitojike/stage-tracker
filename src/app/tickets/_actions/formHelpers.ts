// Mirrors src/app/catalog/_actions/formHelpers.ts's readId - each feature
// keeps its own copy rather than importing across feature `_actions`
// folders (see src/app/calendar/_lib/today.ts's own precedent for this
// per-feature duplication convention). Deliberately not 'use server' - a
// plain synchronous FormData reader, not an action itself.

/** A required identifier carried by a hidden input. Absent or non-string
 * means the request did not come from the form this action serves; it is
 * reported as a generic failure rather than being guessed at. */
export function readId(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
