'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/infrastructure/supabase/serverClient.ts';
import {
  addEventOccurrence,
  createEventWithInitialOccurrence,
  updateEventDetails,
  updateEventOccurrence,
  updateEventRange,
} from '@/infrastructure/supabase/eventCatalogWrite.ts';
import { getEventRange } from '@/infrastructure/supabase/eventCatalogRead.ts';
import {
  eventDetailsToFormValues,
  eventRangeToFormValues,
  hasErrors,
  occurrenceToFormValues,
  parseEventCreate,
  parseEventDetails,
  parseEventRange,
  parseOccurrence,
  validateOccurrenceWithinRange,
  type RawFormValues,
} from '@/domain/eventCatalogWrite.ts';
import {
  acceptedWriteFormState,
  rejectedWriteFormState,
  resolveDuplicateOccurrenceFieldErrors,
  resolveWriteFeedback,
  resolveWriteNotice,
  type EventWriteFormState,
} from '@/domain/eventWriteFeedback.ts';
import { catalogEventHref, resolveCatalogParams } from '@/domain/catalogNavigation.ts';
import { currentTokyoDate } from '../_lib/today.ts';
import { readId } from './formHelpers.ts';

// Server actions for the MVP Event catalog write boundary (Issue #29).
//
// None of these actions decides permission. Authority is enforced by the
// database - create_event_with_occurrence's designated-creator check, and
// events / event_occurrences RLS for owner-only update and occurrence
// management (see supabase/migrations/). What happens here is parsing,
// dispatch, and turning the database's own outcome into the state the form
// renders. A denial therefore surfaces as a denial even if a caller
// bypasses the UI entirely (e.g. by posting a tampered event id), because
// nothing here is what was stopping them.

// Only createEventAction redirects, because only it has somewhere else to
// be: the event it just created. The three edit-screen actions stay on the
// page and report success through their returned state instead. That is
// deliberate - redirecting to the same route with a ?saved= flag kept the
// URL as the success channel, which meant losing the month/date context
// the edit screen navigates back with, leaving the just-submitted values
// in the client component's uncontrolled inputs (the component instance
// survives a same-route navigation), and having the page look a message up
// by an untrusted query string.

const EVENT_FIELDS = ['title', 'venue', 'sourceUrl', 'memo'] as const;
const EVENT_RANGE_FIELDS = ['startsOn', 'endsOn'] as const;
const OCCURRENCE_FIELDS = ['doorsAt', 'startsAt', 'endsAt'] as const;

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

/** The month/day the user was browsing, carried through the form so a
 * completed create returns to the calendar they came from. Re-resolved
 * through the same validator the pages use, so a tampered or missing value
 * degrades to the default month rather than producing a malformed URL. */
function readCatalogContext(formData: FormData) {
  const raw = readFormValues(formData, ['month', 'date']);
  return resolveCatalogParams(raw, currentTokyoDate());
}

export async function createEventAction(
  previous: EventWriteFormState,
  formData: FormData,
): Promise<EventWriteFormState> {
  const values = readFormValues(formData, [
    ...EVENT_FIELDS,
    ...EVENT_RANGE_FIELDS,
    ...OCCURRENCE_FIELDS,
  ]);
  const parsed = parseEventCreate(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();
  const result = await createEventWithInitialOccurrence(client, parsed.value);
  if (!result.ok) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('create-event', result.error.kind),
    );
  }

  revalidatePath('/catalog');
  // Outside the failure branches above: redirect() signals by throwing, so
  // it must not run where a catch could absorb it.
  redirect(catalogEventHref(result.data.id, readCatalogContext(formData)));
}

export async function updateEventDetailsAction(
  previous: EventWriteFormState,
  formData: FormData,
): Promise<EventWriteFormState> {
  const values = readFormValues(formData, EVENT_FIELDS);
  const eventId = readId(formData, 'eventId');
  if (eventId === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-event', 'failure'),
    );
  }

  const parsed = parseEventDetails(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();
  const result = await updateEventDetails(client, eventId, parsed.value);
  if (!result.ok) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-event', result.error.kind),
    );
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/events/${eventId}`);
  // What persisted, not what was typed: parsing trimmed the values and
  // mapped blanks to null, so echoing `values` would show the form a
  // slightly different string from the one now in the database.
  return acceptedWriteFormState(
    previous,
    eventDetailsToFormValues(parsed.value),
    resolveWriteNotice('update-event'),
  );
}

/**
 * Moves an event's Event range (Issue #87/#88). Goes through
 * updateEventRange (reschedule_event under the hood, carrying every
 * existing occurrence through unchanged) rather than a plain events
 * UPDATE, so a range change that would otherwise deadlock against the
 * containment invariant - see updateEventRange's own comment - never has
 * to be worked around from this action.
 */
export async function updateEventRangeAction(
  previous: EventWriteFormState,
  formData: FormData,
): Promise<EventWriteFormState> {
  const values = readFormValues(formData, EVENT_RANGE_FIELDS);
  const eventId = readId(formData, 'eventId');
  if (eventId === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-event', 'failure'),
    );
  }

  const parsed = parseEventRange(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();
  const result = await updateEventRange(client, eventId, parsed.value);
  if (!result.ok) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-event', result.error.kind),
    );
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/events/${eventId}`);
  return acceptedWriteFormState(
    previous,
    eventRangeToFormValues(parsed.value),
    resolveWriteNotice('update-event'),
  );
}

export async function addOccurrenceAction(
  previous: EventWriteFormState,
  formData: FormData,
): Promise<EventWriteFormState> {
  const values = readFormValues(formData, OCCURRENCE_FIELDS);
  const eventId = readId(formData, 'eventId');
  if (eventId === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('add-occurrence', 'failure'),
    );
  }

  const parsed = parseOccurrence(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();

  // Issue #88 containment invariant, checked ahead of the DB round trip -
  // see validateOccurrenceWithinRange's own comment for why this can't
  // live inside parseOccurrence itself.
  const rangeResult = await getEventRange(client, eventId);
  if (!rangeResult.ok || rangeResult.data === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('add-occurrence', 'failure'),
    );
  }
  const containmentErrors = validateOccurrenceWithinRange(parsed.value, rangeResult.data);
  if (hasErrors(containmentErrors)) {
    return rejectedWriteFormState(previous, values, containmentErrors, null);
  }

  const result = await addEventOccurrence(client, eventId, parsed.value);
  if (!result.ok) {
    const { kind } = result.error;
    // Issue #79: this event already has an occurrence at the submitted
    // start instant. Reported at the startsAt field rather than through
    // resolveWriteFeedback's generic banner - the submitted value is what
    // needs to change, so the form should say so at that input.
    if (kind === 'duplicate-occurrence') {
      return rejectedWriteFormState(
        previous,
        values,
        resolveDuplicateOccurrenceFieldErrors(),
        null,
      );
    }
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('add-occurrence', kind),
    );
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/events/${eventId}`);
  // Cleared, unlike the update actions: this form adds *another*
  // occurrence, so leaving the persisted values in it invites adding the
  // same one twice.
  return acceptedWriteFormState(previous, {}, resolveWriteNotice('add-occurrence'));
}

export async function updateOccurrenceAction(
  previous: EventWriteFormState,
  formData: FormData,
): Promise<EventWriteFormState> {
  const values = readFormValues(formData, OCCURRENCE_FIELDS);
  const eventId = readId(formData, 'eventId');
  const occurrenceId = readId(formData, 'occurrenceId');
  if (eventId === null || occurrenceId === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-occurrence', 'failure'),
    );
  }

  const parsed = parseOccurrence(values);
  if (!parsed.ok) {
    return rejectedWriteFormState(previous, values, parsed.fieldErrors, null);
  }

  const client = await createSupabaseServerClient();

  // Issue #88 containment invariant, checked ahead of the DB round trip -
  // see validateOccurrenceWithinRange's own comment for why this can't
  // live inside parseOccurrence itself.
  const rangeResult = await getEventRange(client, eventId);
  if (!rangeResult.ok || rangeResult.data === null) {
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-occurrence', 'failure'),
    );
  }
  const containmentErrors = validateOccurrenceWithinRange(parsed.value, rangeResult.data);
  if (hasErrors(containmentErrors)) {
    return rejectedWriteFormState(previous, values, containmentErrors, null);
  }

  // event_id is deliberately not part of this update - an occurrence is
  // never reassigned to another event. eventId above is used only to
  // navigate back and to revalidate the right paths.
  const result = await updateEventOccurrence(client, occurrenceId, parsed.value);
  if (!result.ok) {
    const { kind } = result.error;
    // Issue #79: the edited start instant collides with another occurrence
    // already on this event. Same startsAt-field treatment as
    // addOccurrenceAction above, for the same reason.
    if (kind === 'duplicate-occurrence') {
      return rejectedWriteFormState(
        previous,
        values,
        resolveDuplicateOccurrenceFieldErrors(),
        null,
      );
    }
    return rejectedWriteFormState(
      previous,
      values,
      {},
      resolveWriteFeedback('update-occurrence', kind),
    );
  }

  revalidatePath('/catalog');
  revalidatePath(`/catalog/events/${eventId}`);
  return acceptedWriteFormState(
    previous,
    occurrenceToFormValues(parsed.value),
    resolveWriteNotice('update-occurrence'),
  );
}
