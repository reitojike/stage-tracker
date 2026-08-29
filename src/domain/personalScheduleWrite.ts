// Personal schedule entry write model (Issue #37): pure parsing and
// validation for the event-independent personal schedule create/edit UI
// journey, over the persistence/typed-boundary baseline Issues #31/#33
// established (personalSchedule.ts / infrastructure/supabase/
// personalSchedule.ts). Re-modeled from a closed schedule_type vocabulary
// to free-form title + blocking by Issue #121.
//
// Product semantics (see .ai-dev-foundation/product-rules.md,
// "Event-independent personal schedule"):
// - Exactly one of two temporal shapes: all-day (single- or multi-day, a
//   closed [startsOn, endsOn] calendar-date range) or time-bounded
//   (startsAt required, endsAt optionally unset).
// - title is required free-form text (trimmed, non-empty). blocking is an
//   independent boolean, defaulting to true on a brand-new create form
//   (product decision: safe planning default, matching the prior implicit
//   "always blocks availability" semantics).
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs). It performs no
// permission judgment either - that is actually enforced by RLS (see
// infrastructure/supabase/personalSchedule.ts).

import { isValidCalendarDate } from './calendarMonth.ts';
import { tokyoDateTimeLocalFromInstant, tokyoDateTimeLocalToInstant } from './eventCatalogWrite.ts';
import type { PersonalScheduleEntryInput, ScheduleTemporal } from './personalSchedule.ts';

/** The raw string-keyed shape a submitted form provides - see
 * eventCatalogWrite.ts's RawFormValues for why every value is optional. */
export type RawFormValues = Partial<Record<string, string>>;

function readField(raw: RawFormValues, key: string): string {
  return raw[key] ?? '';
}

/** The temporal mode a form's radio toggle expresses, before the actual
 * date/time fields have been parsed into a ScheduleTemporal. */
export type ScheduleTemporalMode = 'all-day' | 'time-bounded';

export type ScheduleWriteField =
  'title' | 'temporalMode' | 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt' | 'memo';

export type FieldErrors = Partial<Record<ScheduleWriteField, string>>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

function hasErrors(fieldErrors: FieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}

/** Trims, and treats an all-whitespace value as unset - product-rules.md
 * treats an unset memo as a legitimate state, so a blank input must persist
 * as NULL rather than as an empty string that reads as a set value. */
function optionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseTitle(raw: RawFormValues): ParseResult<string> {
  const trimmed = readField(raw, 'title').trim();
  if (trimmed.length === 0) {
    return { ok: false, fieldErrors: { title: '件名を入力してください。' } };
  }
  return { ok: true, value: trimmed };
}

/**
 * Reads the blocking checkbox. ScheduleFields.tsx renders the checkbox
 * (value="true") before a same-named hidden fallback (value="false") - per
 * the FormData spec, `.get(name)` returns the *first* matching entry in DOM
 * order, so a checked box's "true" entry (which appears first) wins over
 * the hidden "false" that always submits alongside it, while an unchecked
 * box (which submits nothing) leaves only the hidden "false". This is what
 * lets a rejected-submission re-render (which echoes `raw` back into the
 * form's defaultChecked) distinguish "explicitly unchecked" from "field
 * never touched" - a plain absent-checkbox-means-false reading cannot, since
 * both look identical in FormData.
 */
function parseBlocking(raw: RawFormValues): boolean {
  return readField(raw, 'blocking') === 'true';
}

function parseTemporalMode(raw: RawFormValues): ScheduleTemporalMode {
  // An unrecognized/missing value defaults to time-bounded rather than
  // being reported as a field error: the radio always has one option
  // checked in the rendered form, so this branch is reachable only via a
  // tampered submission, not normal use - and time-bounded is the shape
  // requiring the more informative validation (a real starts_at), so
  // defaulting to it surfaces the most useful error rather than silently
  // treating a tampered request as a valid all-day entry.
  return readField(raw, 'temporalMode') === 'all-day' ? 'all-day' : 'time-bounded';
}

function parseAllDayTemporal(raw: RawFormValues): ParseResult<ScheduleTemporal> {
  const fieldErrors: FieldErrors = {};

  const startsOn = readField(raw, 'startsOn').trim();
  if (startsOn.length === 0) {
    fieldErrors.startsOn = '開始日を入力してください。';
  } else if (!isValidCalendarDate(startsOn)) {
    fieldErrors.startsOn = '開始日の形式が正しくありません。';
  }

  // A blank end date means a single-day entry - the same date as the
  // start - rather than a missing field, so a common single-day entry
  // does not require typing the same date twice.
  const rawEndsOn = readField(raw, 'endsOn').trim();
  let endsOn: string | null = null;
  if (rawEndsOn.length > 0) {
    if (!isValidCalendarDate(rawEndsOn)) {
      fieldErrors.endsOn = '終了日の形式が正しくありません。';
    } else {
      endsOn = rawEndsOn;
    }
  }

  if (hasErrors(fieldErrors)) {
    return { ok: false, fieldErrors };
  }

  const resolvedEndsOn = endsOn ?? startsOn;
  if (resolvedEndsOn < startsOn) {
    return { ok: false, fieldErrors: { endsOn: '終了日は開始日より前にできません。' } };
  }

  return { ok: true, value: { kind: 'all-day', startsOn, endsOn: resolvedEndsOn } };
}

function parseTimeBoundedTemporal(raw: RawFormValues): ParseResult<ScheduleTemporal> {
  const fieldErrors: FieldErrors = {};

  const rawStartsAt = readField(raw, 'startsAt').trim();
  let startsAtUtc: string | null = null;
  if (rawStartsAt.length === 0) {
    fieldErrors.startsAt = '開始日時を入力してください。';
  } else {
    startsAtUtc = tokyoDateTimeLocalToInstant(rawStartsAt);
    if (startsAtUtc === null) {
      fieldErrors.startsAt = '開始日時の形式が正しくありません。';
    }
  }

  // An unset end time is a legitimate product state (product-rules.md), so
  // a blank value is accepted as null rather than reported as missing.
  const rawEndsAt = readField(raw, 'endsAt').trim();
  let endsAtUtc: string | null = null;
  if (rawEndsAt.length > 0) {
    endsAtUtc = tokyoDateTimeLocalToInstant(rawEndsAt);
    if (endsAtUtc === null) {
      fieldErrors.endsAt = '終了日時の形式が正しくありません。';
    }
  }

  if (hasErrors(fieldErrors) || startsAtUtc === null) {
    return { ok: false, fieldErrors };
  }

  if (endsAtUtc !== null && Date.parse(endsAtUtc) < Date.parse(startsAtUtc)) {
    return {
      ok: false,
      fieldErrors: { endsAt: '終了日時は開始日時より前にできません。' },
    };
  }

  return { ok: true, value: { kind: 'time-bounded', startsAt: startsAtUtc, endsAt: endsAtUtc } };
}

function parseTemporal(raw: RawFormValues): ParseResult<ScheduleTemporal> {
  return parseTemporalMode(raw) === 'all-day'
    ? parseAllDayTemporal(raw)
    : parseTimeBoundedTemporal(raw);
}

export function parsePersonalScheduleEntry(
  raw: RawFormValues,
): ParseResult<PersonalScheduleEntryInput> {
  const title = parseTitle(raw);
  const temporal = parseTemporal(raw);

  if (!title.ok || !temporal.ok) {
    return {
      ok: false,
      fieldErrors: {
        ...(title.ok ? {} : title.fieldErrors),
        ...(temporal.ok ? {} : temporal.fieldErrors),
      },
    };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      blocking: parseBlocking(raw),
      memo: optionalText(readField(raw, 'memo')),
      temporal: temporal.value,
    },
  };
}

/**
 * Renders an already-persisted entry back into the string shape a form's
 * inputs take, for an edit screen's initial values. Mirrors
 * eventCatalogWrite.ts's eventDetailsToFormValues/occurrenceToFormValues:
 * null becomes an empty string rather than being omitted, so an unset
 * optional field clears the input instead of leaving a stale value in it.
 */
export function personalScheduleEntryToFormValues(
  input: PersonalScheduleEntryInput,
): RawFormValues {
  const temporalValues =
    input.temporal.kind === 'all-day'
      ? {
          temporalMode: 'all-day',
          startsOn: input.temporal.startsOn,
          endsOn: input.temporal.endsOn,
          startsAt: '',
          endsAt: '',
        }
      : {
          temporalMode: 'time-bounded',
          startsOn: '',
          endsOn: '',
          startsAt: tokyoDateTimeLocalFromInstant(input.temporal.startsAt),
          endsAt:
            input.temporal.endsAt === null
              ? ''
              : tokyoDateTimeLocalFromInstant(input.temporal.endsAt),
        };

  return {
    title: input.title,
    blocking: input.blocking ? 'true' : 'false',
    memo: input.memo ?? '',
    ...temporalValues,
  };
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Issue #196's bounded prefill contract for /schedule/new: My Calendar's
 * selected-day "add" action carries only a *date* (see
 * myCalendarNavigation.ts's scheduleNewHrefForDate) - never a time, since
 * none was ever selected - so this seeds the all-day temporal mode with a
 * single-day range rather than fabricating a time the create form would
 * otherwise have to guess (matching this module's own product-rules.md
 * discipline: never fabricate precision a source didn't provide).
 *
 * A malformed/missing `date` query param is ignored (returns `{}`, the same
 * empty initial `values` INITIAL_SCHEDULE_WRITE_FORM_STATE already uses) -
 * this is client-supplied navigation state, not domain data, the same
 * "ignore, don't error" treatment catalogNavigation.ts's
 * resolveCatalogParams gives its own `date` param.
 */
export function resolveScheduleCreatePrefill(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): RawFormValues {
  const rawDate = firstValue(searchParams.date);
  if (rawDate === undefined || !isValidCalendarDate(rawDate)) {
    return {};
  }
  return { temporalMode: 'all-day', startsOn: rawDate, endsOn: rawDate };
}
