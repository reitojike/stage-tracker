import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';

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
    <>
      <TextInput
        label="開催期間（開始日）"
        name="startsOn"
        type="date"
        required
        defaultValue={values.startsOn ?? ''}
        error={fieldErrors.startsOn}
        disabled={disabled}
        helperText={
          endsOnOptional
            ? '公式に公表されている初日です。単発公演は終了日を空欄のままにできます。'
            : '公式に公表されている初日です。単発公演は終了日と同じ日を入力します。'
        }
      />
      <TextInput
        label={endsOnOptional ? '開催期間（終了日・任意）' : '開催期間（終了日）'}
        name="endsOn"
        type="date"
        required={!endsOnOptional}
        defaultValue={values.endsOn ?? ''}
        error={fieldErrors.endsOn}
        disabled={disabled}
        helperText={
          endsOnOptional
            ? '公式に公表されている千秋楽です。空欄のまま登録すると、開始日と同じ日として保存されます。'
            : '公式に公表されている千秋楽です。'
        }
      />
    </>
  );
}
