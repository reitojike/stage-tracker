import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';

export interface EventRangeFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
}

/**
 * The Event range (starts_on/ends_on, Issue #87/#88): the officially
 * published 初日〜千秋楽, required and independent of whatever occurrence
 * rows exist. Both inputs are plain `date` (no time component) - Asia/Tokyo
 * calendar dates, matching the `date`-typed DB columns directly.
 */
export function EventRangeFields({ values, fieldErrors, disabled }: EventRangeFieldsProps) {
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
        helperText="公式に公表されている初日です。単発公演は終了日と同じ日を入力します。"
      />
      <TextInput
        label="開催期間（終了日）"
        name="endsOn"
        type="date"
        required
        defaultValue={values.endsOn ?? ''}
        error={fieldErrors.endsOn}
        disabled={disabled}
        helperText="公式に公表されている千秋楽です。"
      />
    </>
  );
}
