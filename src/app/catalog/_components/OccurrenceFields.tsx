import { TextInput } from '@/ui/TextInput';
import { UNKNOWN_END_TIME_LABEL } from '@/domain/catalogFormatting.ts';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';

export interface OccurrenceFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
  /** Distinguishes the create form's initial occurrence from a further
   * occurrence added later, purely in the helper text. */
  startsAtHelperText?: string;
}

/**
 * One 公演回's times (Issue #29). Both inputs are `datetime-local`, i.e.
 * a wall-clock reading with no zone; they are interpreted as Asia/Tokyo -
 * the product date boundary - by domain/eventCatalogWrite.ts, never by the
 * browser's or server's own timezone.
 *
 * 終演日時 is deliberately optional and is not defaulted from 開演日時: an
 * unknown end time is a legitimate product state, and filling one in would
 * fabricate information the catalog does not have.
 */
export function OccurrenceFields({
  values,
  fieldErrors,
  disabled,
  startsAtHelperText,
}: OccurrenceFieldsProps) {
  return (
    <>
      <TextInput
        label="開演日時"
        name="startsAt"
        type="datetime-local"
        required
        defaultValue={values.startsAt ?? ''}
        error={fieldErrors.startsAt}
        disabled={disabled}
        helperText={startsAtHelperText ?? '日本時間（Asia/Tokyo）で入力します。'}
      />
      <TextInput
        label="終演日時"
        name="endsAt"
        type="datetime-local"
        defaultValue={values.endsAt ?? ''}
        error={fieldErrors.endsAt}
        disabled={disabled}
        helperText={`任意です。未入力の場合は「${UNKNOWN_END_TIME_LABEL}」として扱われます。`}
      />
    </>
  );
}
