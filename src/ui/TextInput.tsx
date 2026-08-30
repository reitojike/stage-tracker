import { useId, type InputHTMLAttributes } from 'react';
import { RequirementIndicator } from './RequirementIndicator';
import styles from './TextInput.module.css';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  error?: string;
  /**
   * Extra class merged onto the `<label>` element only (the plain
   * `className` prop above targets the `<input>`). Optional and additive -
   * every existing caller keeps the default label treatment; Issue #240
   * uses it to scope InviteSheet's 12px/600 label size to that one screen
   * instead of changing this shared primitive's default for every other
   * TextInput consumer (schedule/event/occurrence forms, sign-in) with no
   * reference image to verify those against.
   */
  labelClassName?: string;
}

export function TextInput({
  label,
  helperText,
  error,
  id,
  className,
  labelClassName,
  required,
  'aria-describedby': callerDescribedBy,
  'aria-invalid': callerInvalid,
  ...rest
}: TextInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = helperText ? `${inputId}-helper` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helperId, errorId, callerDescribedBy].filter(Boolean).join(' ') || undefined;
  const invalid = error ? true : callerInvalid;

  return (
    <div className={styles.field}>
      <label className={[styles.label, labelClassName].filter(Boolean).join(' ')} htmlFor={inputId}>
        {label}
        <RequirementIndicator required={!!required} />
      </label>
      <input
        id={inputId}
        className={[styles.input, error ? styles.inputError : undefined, className]
          .filter(Boolean)
          .join(' ')}
        {...rest}
        required={required}
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
