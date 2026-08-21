import { useId, type TextareaHTMLAttributes } from 'react';
import styles from './TextArea.module.css';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  error?: string;
}

/**
 * Multi-line counterpart to TextInput, for free-form fields (e.g. an event
 * memo) where a single-line control would hide most of the value. Label /
 * helper / error wiring, and the aria-describedby and aria-invalid
 * behaviour, are deliberately identical to TextInput's so the two are
 * interchangeable from an accessibility standpoint.
 */
export function TextArea({
  label,
  helperText,
  error,
  id,
  className,
  rows = 4,
  'aria-describedby': callerDescribedBy,
  'aria-invalid': callerInvalid,
  ...rest
}: TextAreaProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helperId = helperText ? `${controlId}-helper` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helperId, errorId, callerDescribedBy].filter(Boolean).join(' ') || undefined;
  const invalid = error ? true : callerInvalid;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={controlId}>
        {label}
      </label>
      <textarea
        id={controlId}
        rows={rows}
        className={[styles.control, error ? styles.controlError : undefined, className]
          .filter(Boolean)
          .join(' ')}
        {...rest}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
      {helperText ? (
        <p id={helperId} className={styles.helperText}>
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.errorText} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
