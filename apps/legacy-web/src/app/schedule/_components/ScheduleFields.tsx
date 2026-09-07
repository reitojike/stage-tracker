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
        {/* The native checkbox remains the form control, but is visually
            hidden so the 18px box and 44px row follow the shared schedule
            vocabulary without changing parseBlocking's field ordering. */}
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            name="blocking"
            value="true"
            defaultChecked={values.blocking !== 'false'}
            disabled={disabled}
            className={styles.controlInput}
          />
          <span className={styles.checkboxBox} aria-hidden="true">
            <svg viewBox="0 0 12 12" focusable="false">
              <path
                d="M2 6.2 L5 9.2 L10 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>この予定がある間は新しい予定を入れない</span>
        </label>
        <input type="hidden" name="blocking" value="false" />
      </div>

      <FormSection as="fieldset" heading="期間の種類" requirement="required">
        <div className={styles.segmentedControl}>
          <label className={styles.segment}>
            <input
              type="radio"
              name="temporalMode"
              value="time-bounded"
              required
              checked={temporalMode === 'time-bounded'}
              disabled={disabled}
              className={styles.controlInput}
              onChange={() => {
                setTemporalMode('time-bounded');
              }}
            />
            <span>時刻を指定</span>
          </label>
          <label className={styles.segment}>
            <input
              type="radio"
              name="temporalMode"
              value="all-day"
              required
              checked={temporalMode === 'all-day'}
              disabled={disabled}
              className={styles.controlInput}
              onChange={() => {
                setTemporalMode('all-day');
              }}
            />
            <span>終日</span>
          </label>
        </div>

        {/* Both field groups always submit (see the temporalMode comment
            above) - only which one is visible/reachable-by-tab changes,
            via `hidden` rather than an unmount, so remounting on toggle
            never drops what was already typed into the group being
            switched away from. */}
        <div hidden={temporalMode !== 'time-bounded'} className={styles.pairedFields}>
          <TextInput
            label="開始日時"
            name="startsAt"
            type="datetime-local"
            className={styles.temporalInput}
            required={temporalMode === 'time-bounded'}
            defaultValue={values.startsAt ?? ''}
            error={fieldErrors.startsAt}
            disabled={disabled}
          />
          <TextInput
            label="終了日時"
            name="endsAt"
            type="datetime-local"
            className={styles.temporalInput}
            defaultValue={values.endsAt ?? ''}
            error={fieldErrors.endsAt}
            disabled={disabled}
            helperText="未定の場合は空欄のままにできます。"
          />
        </div>
        <p hidden={temporalMode !== 'time-bounded'} className={styles.timezoneNote}>
          日本時間（Asia/Tokyo）
        </p>

        <div hidden={temporalMode !== 'all-day'} className={styles.pairedFields}>
          <TextInput
            label="開始日"
            name="startsOn"
            type="date"
            className={styles.temporalInput}
            required={temporalMode === 'all-day'}
            defaultValue={values.startsOn ?? ''}
            error={fieldErrors.startsOn}
            disabled={disabled}
          />
          <TextInput
            label="終了日"
            name="endsOn"
            type="date"
            className={styles.temporalInput}
            defaultValue={values.endsOn ?? ''}
            error={fieldErrors.endsOn}
            disabled={disabled}
            helperText="単日の場合は空欄のままにできます。"
          />
        </div>
        <p hidden={temporalMode !== 'all-day'} className={styles.timezoneNote}>
          日本時間（Asia/Tokyo）
        </p>
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
