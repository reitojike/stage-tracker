'use client';

import { useActionState } from 'react';
import { Button } from '@/ui/Button';
import { StatePanel } from '@/ui/StatePanel';
import { INITIAL_WRITE_FORM_STATE } from '@/domain/eventWriteFeedback.ts';
import type { CatalogParams } from '@/domain/catalogNavigation.ts';
import { createEventAction } from '../_actions/eventWrite.ts';
import { EventFields } from './EventFields.tsx';
import { EventRangeFields } from './EventRangeFields.tsx';
import { OccurrenceFields } from './OccurrenceFields.tsx';
import { EventWriteSection } from './EventWriteSection.tsx';
import styles from './EventWriteForm.module.css';

/**
 * Creates an event together with its Event range and an optional initial
 * occurrence (Issue #29, extended by #87/#88). All three are submitted as
 * one form because they are persisted as one atomic operation - the
 * occurrence sub-form may be left entirely blank, since an event may have
 * zero occurrences at create time (product-rules.md: 開催期間だけが判明し
 * ている段階でも catalog へ登録できる).
 *
 * This component renders only what the write boundary supports. It makes
 * no permission decision: the page above it decides whether to render this
 * form at all, and the database decides whether the submission persists.
 */
export interface EventCreateFormProps {
  /** The month/day the user was browsing. Carried through the submission so
   * a completed create lands on the new event with the same calendar
   * context the surrounding screens navigate with. */
  context: CatalogParams;
}

export function EventCreateForm({ context }: EventCreateFormProps) {
  const [state, formAction, isPending] = useActionState(
    createEventAction,
    INITIAL_WRITE_FORM_STATE,
  );

  return (
    <form
      action={formAction}
      className={[styles.form, styles.fixedForm].join(' ')}
      aria-busy={isPending}
    >
      <input type="hidden" name="month" value={context.yearMonth} />
      {context.selectedDate !== null ? (
        <input type="hidden" name="date" value={context.selectedDate} />
      ) : null}

      {/* Keyed by `attempt` for the same reason WriteNotice keys its message:
          resolveWriteFeedback returns module-level constants, so a second
          identical failure would re-render StatePanel with referentially
          identical props and commit no DOM mutation, leaving the retry
          silent. StatePanel's own role="alert" is announced on insertion,
          so replacing the node is what makes the retry audible. */}
      {state.feedback ? (
        <StatePanel
          key={state.attempt}
          variant={state.feedback.variant}
          title={state.feedback.title}
          description={state.feedback.description}
        />
      ) : null}

      {/* Remount key: an already-mounted uncontrolled input ignores a
          changed defaultValue, so without this a rejected submission would
          re-render with the previous attempt's values still in the DOM. */}
      <div key={state.attempt} className={styles.fields}>
        <EventWriteSection>
          <EventFields values={state.values} fieldErrors={state.fieldErrors} disabled={isPending} />
        </EventWriteSection>
        <EventWriteSection heading="開催期間">
          <EventRangeFields
            values={state.values}
            fieldErrors={state.fieldErrors}
            disabled={isPending}
            endsOnOptional
          />
          <p className={styles.sectionDescription}>
            公式に公表されている日付です。千秋楽を空欄のまま登録すると、初日と同じ日として保存されます。
          </p>
        </EventWriteSection>

        <EventWriteSection
          heading="初回公演回"
          requirement="optional"
          action="任意"
          subtle
          description="空のまま作成できます。公演回は後から追加できます。"
        >
          <OccurrenceFields
            values={state.values}
            fieldErrors={state.fieldErrors}
            disabled={isPending}
            startsAtRequired={false}
            showFieldHelperText={false}
            compactHelperText="空欄の開場は未公表、終演は終了時刻未定として扱われます。すべて日本時間（Asia/Tokyo）です。"
          />
        </EventWriteSection>
      </div>

      <div className={styles.fixedSubmit}>
        <Button type="submit" className={styles.stablePendingButton} disabled={isPending}>
          <span className={styles.stablePendingLabel}>
            <span aria-hidden="true" className={styles.stablePendingSizing}>
              イベントを作成
            </span>
            <span>{isPending ? '作成中…' : 'イベントを作成'}</span>
          </span>
        </Button>
      </div>
    </form>
  );
}
