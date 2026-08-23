'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import {
  createPersonalScheduleEntry,
  removeScheduleShare,
  shareScheduleEntryByEmail,
  updatePersonalScheduleEntry,
} from '@/infrastructure/supabase/personalSchedule.ts';
import {
  parsePersonalScheduleEntry,
  personalScheduleEntryToFormValues,
  type RawFormValues,
} from '@/domain/personalScheduleWrite.ts';
import {
  acceptedShareAddFormState,
  acceptedWriteFormState,
  rejectedShareAddFormState,
  rejectedShareRemoveFormState,
  rejectedWriteFormState,
  resolveOwnerRemoveShareFeedback,
  resolveRemoveShareFeedback,
  resolveShareByEmailOutcome,
  resolveWriteFeedback,
  resolveWriteNotice,
  type ScheduleShareAddFormState,
  type ScheduleShareRemoveFormState,
  type ScheduleWriteFormState,
} from '@/domain/personalScheduleWriteFeedback.ts';

// Server actions for the personal schedule write journey (Issue #37).
//
// None of these actions decides permission. Authority is enforced by the
// database - personal_schedule_entries_insert_own / _update_own,
// personal_schedule_shares_delete_owner_or_self RLS, and
// share_schedule_entry_by_email / list_schedule_share_recipient_emails's
// own owner-only checks (see supabase/migrations/). What happens here is
// parsing, dispatch, and turning the typed boundary's own outcome
// (PlanningResult) into the state the form renders.
//
// Owner-side recipient add/remove now consumes #55's exact-email
// authenticated-user targeting boundary (shareScheduleEntryByEmail /
// listScheduleShareRecipientEmails) - no raw user id, generic email
// lookup, autocomplete, or user directory is added here; the RPCs
// themselves resolve an exact registered email to a user id server-side
// and scope the recipient projection to this entry's actual shares only.

const SCHEDULE_FIELDS = [
  'scheduleType',
  'temporalMode',
  'startsOn',
  'endsOn',
  'startsAt',
  'endsAt',
  'memo',
] as const;

function readFormValues(formData: FormData, keys: readonly string[]): RawFormValues {
  const values: RawFormValues = {};
  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === 'string') {
      values[key] = value;
    }
  }
  return values;
}

/** A required identifier carried by a hidden input. Absent or non-string
 * means the request did not come from the form this action serves - see
 * catalog's eventWrite.ts readId for the same reasoning. */
function readId(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function createScheduleEntryAction(
  previous: ScheduleWriteFormState,
  formData: FormData,
): Promise<ScheduleWriteFormState> {
  const values = readFormValues(formData, SCHEDULE_FIELDS);
  const parsed = parsePersonalScheduleEntry(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();
  const result = await createPersonalScheduleEntry(client, parsed.value);
  if (!result.ok) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('create-schedule-entry', result.error.kind),
    );
  }

  revalidatePath('/schedule');
  // Outside the failure branches above: redirect() signals by throwing, so
  // it must not run where a catch could absorb it.
  redirect(`/schedule/${result.data.id}`);
}

export async function updateScheduleEntryAction(
  previous: ScheduleWriteFormState,
  formData: FormData,
): Promise<ScheduleWriteFormState> {
  const values = readFormValues(formData, SCHEDULE_FIELDS);
  const entryId = readId(formData, 'entryId');
  if (entryId === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-schedule-entry', 'failure'),
    );
  }

  const parsed = parsePersonalScheduleEntry(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();
  const result = await updatePersonalScheduleEntry(client, entryId, parsed.value);
  if (!result.ok) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-schedule-entry', result.error.kind),
    );
  }

  revalidatePath('/schedule');
  revalidatePath(`/schedule/${entryId}`);
  // What persisted, not what was typed - parsing trimmed the values and
  // mapped blanks to null, so echoing `values` would show the form a
  // slightly different string from the one now in the database.
  return acceptedWriteFormState(
    previous,
    personalScheduleEntryToFormValues(parsed.value),
    resolveWriteNotice('update-schedule-entry'),
  );
}

export async function removeScheduleShareAction(
  previous: ScheduleShareRemoveFormState,
  formData: FormData,
): Promise<ScheduleShareRemoveFormState> {
  const shareId = readId(formData, 'shareId');
  if (shareId === null) {
    return rejectedShareRemoveFormState(previous, resolveRemoveShareFeedback('failure'));
  }

  const client = await createSupabaseServerClient();
  const result = await removeScheduleShare(client, shareId);
  if (!result.ok) {
    return rejectedShareRemoveFormState(previous, resolveRemoveShareFeedback(result.error.kind));
  }

  revalidatePath('/schedule');
  // Outside the failure branch above - see createScheduleEntryAction. The
  // entry this share pointed at drops out of the caller's own visibility
  // the moment this commits (personal_schedule_entries_select_owner_or_
  // shared no longer matches), so there is nothing left on the detail page
  // to return to.
  redirect('/schedule');
}

/** Reads the trimmed raw email a form submitted, defaulting to '' rather
 * than throwing on a missing/non-string field - shareScheduleEntryByEmail's
 * own RPC validates presence/format and reports a proper `validation`
 * PlanningError, so this only needs to hand it *something*. */
function readEmail(formData: FormData): string {
  const value = formData.get('email');
  return typeof value === 'string' ? value.trim() : '';
}

export async function addScheduleShareByEmailAction(
  previous: ScheduleShareAddFormState,
  formData: FormData,
): Promise<ScheduleShareAddFormState> {
  const entryId = readId(formData, 'entryId');
  const email = readEmail(formData);
  if (entryId === null) {
    const outcome = resolveShareByEmailOutcome({
      kind: 'failure',
      message: 'missing entryId',
      code: 'missing-entry-id',
    });
    return rejectedShareAddFormState(previous, email, outcome.fieldError, outcome.feedback);
  }

  const client = await createSupabaseServerClient();
  const result = await shareScheduleEntryByEmail(client, entryId, email);
  if (!result.ok) {
    const outcome = resolveShareByEmailOutcome(result.error);
    return rejectedShareAddFormState(previous, email, outcome.fieldError, outcome.feedback);
  }

  revalidatePath(`/schedule/${entryId}`);
  return acceptedShareAddFormState(previous);
}

export async function removeScheduleShareAsOwnerAction(
  previous: ScheduleShareRemoveFormState,
  formData: FormData,
): Promise<ScheduleShareRemoveFormState> {
  const shareId = readId(formData, 'shareId');
  const entryId = readId(formData, 'entryId');
  if (shareId === null) {
    return rejectedShareRemoveFormState(previous, resolveOwnerRemoveShareFeedback('failure'));
  }

  const client = await createSupabaseServerClient();
  const result = await removeScheduleShare(client, shareId);
  if (!result.ok) {
    return rejectedShareRemoveFormState(
      previous,
      resolveOwnerRemoveShareFeedback(result.error.kind),
    );
  }

  // Unlike the self-remove action above, the owner is still allowed to be
  // on this entry's detail page after removing a *different* recipient's
  // share, so this stays on the page (revalidating it) rather than
  // redirecting.
  if (entryId !== null) {
    revalidatePath(`/schedule/${entryId}`);
  }
  return { attempt: previous.attempt + 1, feedback: null };
}
