import { useEffect, useId, useRef, type ReactNode } from 'react';
import { nextTriState, type TriState } from './triState';
import styles from './TriStateCheckbox.module.css';

export type { TriState };

export interface TriStateCheckboxProps {
  id?: string;
  state: TriState;
  label: ReactNode;
  onChange: (next: 'checked' | 'unchecked') => void;
  disabled?: boolean;
  className?: string;
}

const STATE_CLASS: Record<TriState, keyof typeof styles> = {
  checked: 'checked',
  unchecked: 'unchecked',
  indeterminate: 'indeterminate',
};

/**
 * Generic checked/unchecked/indeterminate control (Issue #139). The visible
 * label row is the full tap target (min-height 44px) - the native
 * `<input type="checkbox">` itself is visually hidden but stays in the DOM so
 * Tab/Space keep working exactly as they do for any other checkbox. Checked
 * vs indeterminate is told apart by shape (check mark vs bar), not color
 * alone.
 *
 * This component has no parent/child wiring of its own - a caller that needs
 * that recomputes the parent's `state` from `deriveTriState` (see
 * ./triState) and passes the result back in as a prop, same as any other
 * controlled input.
 */
export function TriStateCheckbox({
  id,
  state,
  label,
  onChange,
  disabled,
  className,
}: TriStateCheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const inputRef = useRef<HTMLInputElement>(null);

  // Native `indeterminate` isn't a settable HTML attribute - it's a DOM
  // property only, so browsers/AT that key off it (rather than the explicit
  // aria-checked below) need it applied imperatively after each state
  // change.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = state === 'indeterminate';
    }
  }, [state]);

  return (
    <label htmlFor={inputId} className={[styles.row, className].filter(Boolean).join(' ')}>
      <input
        ref={inputRef}
        id={inputId}
        type="checkbox"
        className={styles.input}
        checked={state === 'checked'}
        disabled={disabled}
        aria-checked={state === 'indeterminate' ? 'mixed' : undefined}
        onChange={() => {
          onChange(nextTriState(state));
        }}
      />
      <span className={[styles.box, styles[STATE_CLASS[state]]].join(' ')} aria-hidden="true">
        {state === 'checked' ? (
          <svg className={styles.check} viewBox="0 0 12 12" focusable="false">
            <path
              d="M2 6.2 L5 9.2 L10 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {state === 'indeterminate' ? <span className={styles.dash} /> : null}
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  );
}
