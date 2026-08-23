// Personal schedule entry write model (Issue #37): pure parsing and
// validation for the event-independent personal schedule create/edit UI
// journey, over the persistence/typed-boundary baseline Issues #31/#33
// established (personalSchedule.ts / infrastructure/supabase/
// personalSchedule.ts).
//
// Product semantics (see .ai-dev-foundation/product-rules.md,
// "Event-independent personal schedule"):
// - Exactly one of two temporal shapes: all-day (single- or multi-day, a
//   closed [startsOn, endsOn] calendar-date range) or time-bounded
//   (startsAt required, endsAt optionally unset).
// - schedule_type is a closed MVP vocabulary: paid_leave / work / travel /
//   other.
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs). It performs no
// permission judgment either - that is actually enforced by RLS (see
// infrastructure/supabase/personalSchedule.ts).

import { isValidCalendarDate } from './calendarMonth.ts';
import { tokyoDateTimeLocalFromInstant, tokyoDateTimeLocalToInstant } from './eventCatalogWrite.ts';
import type {
  PersonalScheduleEntryInput,
  ScheduleTemporal,
  ScheduleType,
} from './personalSchedule.ts';

const SCHEDULE_TYPES: ReadonlySet<string> = new Set<ScheduleType>([
  'paid_leave',
  'work',
  'travel',
  'other',
]);

function isScheduleType(value: string): value is ScheduleType {
  return SCHEDULE_TYPES.has(value);
}

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
  'scheduleType' | 'temporalMode' | 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt' | 'memo';

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

function parseScheduleType(raw: RawFormValues): ParseResult<ScheduleType> {
  const value = readField(raw, 'scheduleType').trim();
  if (!isScheduleType(value)) {
    return {
      ok: false,
      fieldErrors: { scheduleType: '種別を選択してください。' },
    };
  }
  return { ok: true, value };
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
  const scheduleType = parseScheduleType(raw);
  const temporal = parseTemporal(raw);

  if (!scheduleType.ok || !temporal.ok) {
    return {
      ok: false,
      fieldErrors: {
        ...(scheduleType.ok ? {} : scheduleType.fieldErrors),
        ...(temporal.ok ? {} : temporal.fieldErrors),
      },
    };
  }

  return {
    ok: true,
    value: {
      scheduleType: scheduleType.value,
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
    scheduleType: input.scheduleType,
    memo: input.memo ?? '',
    ...temporalValues,
  };
}
