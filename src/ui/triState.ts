/**
 * Generic tri-state checkbox contract (Issue #139). Domain-independent: no
 * catalog/classification data lives here, only the pure state algebra a
 * parent/child hierarchy needs to stay consistent.
 */
export type TriState = 'checked' | 'unchecked' | 'indeterminate';

/**
 * The result of activating (Space/click) a tri-state control. `indeterminate`
 * and `unchecked` both resolve to `checked` - there is no third target state
 * a toggle can land on.
 */
export function nextTriState(current: TriState): 'checked' | 'unchecked' {
  return current === 'checked' ? 'unchecked' : 'checked';
}

/**
 * Recomputes a parent's tri-state from its immediate children: all checked ->
 * checked, all unchecked (including zero children) -> unchecked, anything
 * mixed (including a child that is itself indeterminate) -> indeterminate.
 */
export function deriveTriState(childStates: readonly TriState[]): TriState {
  if (childStates.length === 0) {
    return 'unchecked';
  }
  if (childStates.every((state) => state === 'checked')) {
    return 'checked';
  }
  if (childStates.every((state) => state === 'unchecked')) {
    return 'unchecked';
  }
  return 'indeterminate';
}
