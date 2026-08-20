import { useId, type InputHTMLAttributes } from 'react';
import styles from './TextInput.module.css';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  error?: string;
}

export function TextInput({
  label,
  helperText,
  error,
  id,
  className,
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
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={[styles.input, error ? styles.inputError : undefined, className]
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
