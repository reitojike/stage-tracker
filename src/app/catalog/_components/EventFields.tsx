import { TextArea } from '@/ui/TextArea';
import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/eventCatalogWrite.ts';

export interface EventFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
}

/**
 * The event's descriptive fields (Issue #29), shared by the create and
 * edit forms so both present the same field set, names and validation
 * messages. Deliberately excludes owner and every system-managed field:
 * they carry no write grant, so offering them would be an affordance the
 * database would refuse.
 *
 * Temporal fields are absent by design - they belong to the occurrence
 * (see OccurrenceFields), never to the event.
 */
export function EventFields({ values, fieldErrors, disabled }: EventFieldsProps) {
  return (
    <>
      <TextInput
        label="タイトル"
        name="title"
        required
        defaultValue={values.title ?? ''}
        error={fieldErrors.title}
        disabled={disabled}
        helperText="カタログ上に表示される公演・イベント名です。"
      />
      <TextInput
        label="会場"
        name="venue"
        defaultValue={values.venue ?? ''}
        error={fieldErrors.venue}
        disabled={disabled}
        helperText="任意です。"
      />
      <TextInput
        label="参照URL"
        name="sourceUrl"
        type="url"
        inputMode="url"
        defaultValue={values.sourceUrl ?? ''}
        error={fieldErrors.sourceUrl}
        disabled={disabled}
        helperText="任意です。公式サイト等の http:// または https:// で始まるURL。"
      />
      <TextArea
        label="メモ"
        name="memo"
        defaultValue={values.memo ?? ''}
        error={fieldErrors.memo}
        disabled={disabled}
        helperText="任意です。"
      />
    </>
  );
}
