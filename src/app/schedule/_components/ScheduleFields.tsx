import { useId, useState } from 'react';
import { TextArea } from '@/ui/TextArea';
import { TextInput } from '@/ui/TextInput';
import type { FieldErrors, RawFormValues } from '@/domain/personalScheduleWrite.ts';
import type { ScheduleType } from '@/domain/personalSchedule.ts';
import { scheduleTypeLabel } from '@/domain/personalScheduleFormatting.ts';
import styles from './ScheduleWriteForm.module.css';

export interface ScheduleFieldsProps {
  values: RawFormValues;
  fieldErrors: FieldErrors;
  disabled?: boolean;
}

const SCHEDULE_TYPES: readonly ScheduleType[] = ['paid_leave', 'work', 'travel', 'other'];

/**
 * The personal schedule entry's fields (Issue #37), shared by the create
 * and edit forms so both present the same field set, names and validation
 * messages - mirrors src/app/catalog/_components/EventFields.tsx.
 *
 * Unlike the Event/Occurrence split, a schedule entry's temporal shape
 * lives on the entry itself (personalSchedule.ts's ScheduleTemporal), so
 * the all-day/time-bounded toggle and both field sets live in this one
 * component rather than being split across two.
 */
export function ScheduleFields({ values, fieldErrors, disabled }: ScheduleFieldsProps) {
  const scheduleTypeId = useId();
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
        <div>
          <label htmlFor={scheduleTypeId}>種別</label>
          <select
            id={scheduleTypeId}
            name="scheduleType"
            defaultValue={values.scheduleType ?? ''}
            disabled={disabled}
            required
            aria-invalid={fieldErrors.scheduleType ? true : undefined}
          >
            <option value="" disabled>
              選択してください
            </option>
            {SCHEDULE_TYPES.map((type) => (
              <option key={type} value={type}>
                {scheduleTypeLabel(type)}
              </option>
            ))}
          </select>
          {fieldErrors.scheduleType ? <p role="alert">{fieldErrors.scheduleType}</p> : null}
        </div>
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.groupLegend}>期間の種類</legend>
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
            helperText="任意です。未定の場合は空欄のままにできます。"
          />
        </div>

        <div hidden={temporalMode !== 'all-day'} className={styles.fields}>
          <TextInput
            label="開始日"
            name="startsOn"
            type="date"
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
            helperText="任意です。単日の場合は空欄のままにできます。"
          />
        </div>
      </fieldset>

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
