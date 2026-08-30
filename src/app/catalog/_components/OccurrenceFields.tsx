import { TextInput } from '@/ui/TextInput';
import { UNKNOWN_END_TIME_LABEL } from '@/domain/catalogFormatting.ts';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';
import styles from './EventWriteForm.module.css';

export interface OccurrenceFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
  /** Distinguishes the create form's initial occurrence from a further
   * occurrence added later, purely in the helper text. */
  startsAtHelperText?: string;
  /** Condenses the three field-level temporal hints into one group-level
   * explanation while retaining the empty-value and timezone semantics. */
  compactHelperText?: string;
  /** Lets a surrounding group own the one consolidated explanation. */
  showFieldHelperText?: boolean;
  /** Add/update occurrence forms always require 開演日時 (there is no
   * concept of a blank occurrence once it exists). The create form's
   * initial-occurrence sub-form is the one exception (Issue #87/#88: an
   * event may have zero occurrences at create time) - it passes `false` so
   * the browser does not block submitting the rest of the form when this
   * sub-form is left entirely blank. Defaults to true. */
  startsAtRequired?: boolean;
}

/**
 * One 公演回の開場 / 開演 / 終演 (Issue #29, 開場 added by Issue #88). All
 * three inputs are `datetime-local`, i.e. a wall-clock reading with no
 * zone; they are interpreted as Asia/Tokyo - the product date boundary - by
 * domain/eventCatalogWrite.ts, never by the browser's or server's own
 * timezone.
 *
 * 開場日時 / 終演日時 are deliberately optional and are not defaulted from
 * 開演日時: an unpublished doors/end time is a legitimate product state,
 * and filling one in would fabricate information the catalog does not
 * have.
 */
export function OccurrenceFields({
  values,
  fieldErrors,
  disabled,
  startsAtHelperText,
  compactHelperText,
  showFieldHelperText = true,
  startsAtRequired = true,
}: OccurrenceFieldsProps) {
  return (
    <>
      <TextInput
        label="開場日時"
        name="doorsAt"
        type="datetime-local"
        defaultValue={values.doorsAt ?? ''}
        error={fieldErrors.doorsAt}
        disabled={disabled}
        helperText={
          compactHelperText || !showFieldHelperText
            ? undefined
            : '未入力の場合は未公表として扱われます。'
        }
      />
      <TextInput
        label="開演日時"
        name="startsAt"
        type="datetime-local"
        required={startsAtRequired}
        defaultValue={values.startsAt ?? ''}
        error={fieldErrors.startsAt}
        disabled={disabled}
        helperText={
          compactHelperText || !showFieldHelperText
            ? undefined
            : (startsAtHelperText ?? '日本時間（Asia/Tokyo）で入力します。')
        }
      />
      <TextInput
        label="終演日時"
        name="endsAt"
        type="datetime-local"
        defaultValue={values.endsAt ?? ''}
        error={fieldErrors.endsAt}
        disabled={disabled}
        helperText={
          compactHelperText || !showFieldHelperText
            ? undefined
            : `未入力の場合は「${UNKNOWN_END_TIME_LABEL}」として扱われます。`
        }
      />
      {compactHelperText ? <p className={styles.occurrenceHelper}>{compactHelperText}</p> : null}
    </>
  );
}
