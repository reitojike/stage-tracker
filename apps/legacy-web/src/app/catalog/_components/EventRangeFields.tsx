import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';
import styles from './EventWriteForm.module.css';

export interface EventRangeFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
  /** Create flow only (Issue #91): renders endsOn as optional and explains
   * that a blank value is saved as the same day as startsOn. The Event
   * range edit form does not set this - endsOn stays required there (Gate A
   * scopes the input simplification to create). */
  endsOnOptional?: boolean;
}

/**
 * The Event range (starts_on/ends_on, Issue #87/#88, endsOn simplified for
 * create by #91): the officially published 初日〜千秋楽, independent of
 * whatever occurrence rows exist. Both inputs are plain `date` (no time
 * component) - Asia/Tokyo calendar dates, matching the `date`-typed DB
 * columns directly.
 */
export function EventRangeFields({
  values,
  fieldErrors,
  disabled,
  endsOnOptional = false,
}: EventRangeFieldsProps) {
  return (
    <div className={styles.datePair}>
      <TextInput
        label="初日"
        name="startsOn"
        type="date"
        required
        defaultValue={values.startsOn ?? ''}
        error={fieldErrors.startsOn}
        disabled={disabled}
      />
      <TextInput
        label="千秋楽"
        name="endsOn"
        type="date"
        required={!endsOnOptional}
        defaultValue={values.endsOn ?? ''}
        error={fieldErrors.endsOn}
        disabled={disabled}
      />
    </div>
  );
}
