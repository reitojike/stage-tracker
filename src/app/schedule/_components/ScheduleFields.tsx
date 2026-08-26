import { useState } from 'react';
import { FormSection } from '@/ui/FormSection';
import { TextArea } from '@/ui/TextArea';
import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/personalScheduleWrite.ts';
import styles from './ScheduleWriteForm.module.css';

export interface ScheduleFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
}

/**
 * The personal schedule entry's fields (Issue #37; re-modeled from a fixed
 * 種別 select to free-form title + blocking by Issue #121), shared by the
 * create and edit forms so both present the same field set, names and
 * validation messages - mirrors src/app/catalog/_components/EventFields.tsx.
 *
 * Unlike the Event/Occurrence split, a schedule entry's temporal shape
 * lives on the entry itself (personalSchedule.ts's ScheduleTemporal), so
 * the all-day/time-bounded toggle and both field sets live in this one
 * component rather than being split across two.
 */
export function ScheduleFields({ values, fieldErrors, disabled }: ScheduleFieldsProps) {
  // Defaults to time-bounded when unset, matching
  // personalScheduleWrite.ts's parseTemporalMode default for a form with no
  // prior submission (a brand-new create form). This is display-only state
  // (which field group is shown) - the radio inputs themselves stay
  // uncontrolled (defaultChecked), and both field groups still submit, so
  // parsing on the server is unaffected by whichever group was hidden.
  const [temporalMode, setTemporalMode] = useState<'all-day' | 'time-bounded'>(
    values.temporalMode === 'all-day' ? 'all-day' : 'time-bounded',
  );

  return (
    <>
      <div className={styles.fields}>
        <TextInput
          label="件名"
          name="title"
          defaultValue={values.title ?? ''}
          error={fieldErrors.title}
          disabled={disabled}
          required
        />
      </div>

      <div>
        {/* Checkbox before the same-named hidden fallback, in that DOM
            order - see personalScheduleWrite.ts's parseBlocking for why
            this specific order is what lets an explicit uncheck survive a
            rejected-submission re-render. */}
        <label className={styles.radioOption}>
          <input
            type="checkbox"
            name="blocking"
            value="true"
            defaultChecked={values.blocking !== 'false'}
            disabled={disabled}
          />
          この予定がある間は新しい予定を入れないようにする（blocking）
        </label>
        <input type="hidden" name="blocking" value="false" />
      </div>

      <FormSection as="fieldset" heading="期間の種類" requirement="required">
        <div className={styles.radioRow}>
          <label className={styles.radioOption}>
            <input
              type="radio"
              name="temporalMode"
              value="time-bounded"
              defaultChecked={temporalMode === 'time-bounded'}
              disabled={disabled}
              onChange={() => {
                setTemporalMode('time-bounded');
              }}
            />
            時刻を指定
          </label>
          <label className={styles.radioOption}>
            <input
              type="radio"
              name="temporalMode"
              value="all-day"
              defaultChecked={temporalMode === 'all-day'}
              disabled={disabled}
              onChange={() => {
                setTemporalMode('all-day');
              }}
            />
            終日（複数日も可）
          </label>
        </div>

        {/* Both field groups always submit (see the temporalMode comment
            above) - only which one is visible/reachable-by-tab changes,
            via `hidden` rather than an unmount, so remounting on toggle
            never drops what was already typed into the group being
            switched away from. */}
        <div hidden={temporalMode !== 'time-bounded'} className={styles.fields}>
          <TextInput
            label="開始日時"
            name="startsAt"
            type="datetime-local"
            required={temporalMode === 'time-bounded'}
            defaultValue={values.startsAt ?? ''}
            error={fieldErrors.startsAt}
            disabled={disabled}
            helperText="日本時間（Asia/Tokyo）で入力します。"
          />
          <TextInput
            label="終了日時"
            name="endsAt"
            type="datetime-local"
            defaultValue={values.endsAt ?? ''}
            error={fieldErrors.endsAt}
            disabled={disabled}
            helperText="未定の場合は空欄のままにできます。"
          />
        </div>

        <div hidden={temporalMode !== 'all-day'} className={styles.fields}>
          <TextInput
            label="開始日"
            name="startsOn"
            type="date"
            required={temporalMode === 'all-day'}
            defaultValue={values.startsOn ?? ''}
            error={fieldErrors.startsOn}
            disabled={disabled}
            helperText="日本時間（Asia/Tokyo）の日付です。"
          />
          <TextInput
            label="終了日"
            name="endsOn"
            type="date"
            defaultValue={values.endsOn ?? ''}
            error={fieldErrors.endsOn}
            disabled={disabled}
            helperText="単日の場合は空欄のままにできます。"
          />
        </div>
      </FormSection>

      <TextArea
        label="メモ"
        name="memo"
        defaultValue={values.memo ?? ''}
        error={fieldErrors.memo}
        disabled={disabled}
      />
    </>
  );
}
