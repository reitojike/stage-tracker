// Event catalog write model (Issue #29): pure parsing, validation and
// error classification for the MVP Event catalog write boundary.
//
// Product semantics (see .ai-dev-foundation/product-rules.md):
// - Temporal data lives on the occurrence, never on the event. The event
//   carries only descriptive fields (title / venue / 参照URL / memo).
// - An unset end time is a valid state and is never coerced to a default.
// - The product date boundary is Asia/Tokyo; persisted timestamps are
//   timestamptz (UTC instants over the wire).
//
// This module is pure domain logic: no Supabase/DB import (see the
// architecture import boundary in eslint.config.mjs). It performs no
// permission judgment either - that lives in ./eventPermissions.ts, and is
// actually enforced by RLS/grants/the create RPC.

import { isRenderableHttpUrl } from './catalogFormatting.ts';
import {
  parseTokyoCalendarDate,
  tokyoCalendarDateFromInstant,
  type RawPostgrestError,
} from './eventCatalog.ts';

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Descriptive event fields an owner may set. Excludes owner_id and every
 * system-managed field, which no client may write at all. */
export interface EventDetailsInput {
  title: string;
  venue: string | null;
  sourceUrl: string | null;
  memo: string | null;
}

/** Event range (Issue #87/#88): Asia/Tokyo calendar dates, both inclusive.
 * Independent of EventDetailsInput because it is edited through a separate
 * write path (reschedule_event, not a plain events UPDATE) once the event
 * already has occurrences - see rescheduleEvent in
 * src/infrastructure/supabase/eventCatalogWrite.ts. */
export interface EventRangeInput {
  startsOn: string;
  endsOn: string;
}

export interface OccurrenceInput {
  doorsAtUtc: string | null;
  startsAtUtc: string;
  endsAtUtc: string | null;
}

/**
 * An event, its Event range, and an optional initial occurrence - all
 * three persisted atomically by create_event. The initial occurrence is
 * optional (Issue #87/#88: an event may have zero occurrences at create
 * time), unlike the create RPC's previous required-occurrence contract.
 */
export interface EventCreateInput {
  details: EventDetailsInput;
  range: EventRangeInput;
  initialOccurrence: OccurrenceInput | null;
}

export type EventWriteField =
  | 'title'
  | 'venue'
  | 'sourceUrl'
  | 'memo'
  | 'startsOn'
  | 'endsOn'
  | 'doorsAt'
  | 'startsAt'
  | 'endsAt';

export type FieldErrors = Partial<Record<EventWriteField, string>>;

/**
 * Field-level parse outcome. Errors are keyed by field so a form can put
 * each message next to the input it belongs to, rather than collapsing
 * every problem into one banner.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

export function hasErrors(fieldErrors: FieldErrors): boolean {
  return Object.keys(fieldErrors).length > 0;
}

/** Trims, and treats an all-whitespace value as unset. product-rules.md
 * treats "not set" as a legitimate state for these fields, so a blank input
 * must persist as NULL rather than as an empty string that reads as a set
 * value. */
function optionalText(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const TOKYO_DATE_TIME_LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts an `<input type="datetime-local">` value - a wall-clock reading
 * with no zone - into the UTC instant it denotes in Asia/Tokyo, as an ISO
 * string.
 *
 * Asia/Tokyo has a fixed UTC+9 offset with no DST, so this is plain
 * arithmetic (the same constant the read side uses in eventCatalog.ts)
 * rather than a timezone database. It deliberately never consults the JS
 * runtime's local timezone: `new Date('2026-08-22T19:00')` would be
 * interpreted in whatever zone the server happens to run in, silently
 * shifting every persisted time by that machine's offset.
 *
 * Returns null for anything that is not a well-formed Tokyo wall-clock
 * value, including a date that passes the digit-shape check but is not a
 * real calendar date (e.g. 2026-02-30).
 */
export function tokyoDateTimeLocalToInstant(value: string): string | null {
  const match = TOKYO_DATE_TIME_LOCAL.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, dateStr, hoursStr, minutesStr, secondsStr] = match;
  if (dateStr === undefined || hoursStr === undefined || minutesStr === undefined) {
    return null;
  }

  let date;
  try {
    date = parseTokyoCalendarDate(dateStr);
  } catch {
    return null;
  }

  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);
  const seconds = secondsStr === undefined ? 0 : Number(secondsStr);
  // Date.UTC would silently normalize 25:00 into the next day rather than
  // rejecting it, so the components are range-checked before use.
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }

  const ms =
    Date.UTC(date.year, date.month - 1, date.day, hours, minutes, seconds, 0) - TOKYO_OFFSET_MS;
  return new Date(ms).toISOString();
}

/**
 * The inverse, for pre-filling an edit form's `datetime-local` input with
 * an already-persisted instant: "YYYY-MM-DDTHH:mm" in Asia/Tokyo. Seconds
 * are omitted because the create/edit form works at minute granularity;
 * this is a form-value formatter, not a display label (see
 * catalogFormatting.ts for those).
 */
export function tokyoDateTimeLocalFromInstant(instantIso: string): string {
  const instantMs = Date.parse(instantIso);
  if (Number.isNaN(instantMs)) {
    throw new Error(`expected a valid ISO 8601 instant, got: ${instantIso}`);
  }
  const tokyo = new Date(instantMs + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  const hours = String(tokyo.getUTCHours()).padStart(2, '0');
  const minutes = String(tokyo.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/** The raw string-keyed shape a submitted form provides. Every value is
 * optional/unknown because a form body is untrusted input, not a typed
 * object. */
export type RawFormValues = Partial<Record<string, string>>;

function readField(raw: RawFormValues, key: string): string {
  return raw[key] ?? '';
}

export function parseEventDetails(raw: RawFormValues): ParseResult<EventDetailsInput> {
  const fieldErrors: FieldErrors = {};

  const title = readField(raw, 'title').trim();
  if (title.length === 0) {
    fieldErrors.title = 'タイトルを入力してください。';
  }

  const sourceUrl = optionalText(readField(raw, 'sourceUrl'));
  // 参照URL is a URL field, and the read side only renders http(s) values
  // as links (catalogFormatting.isRenderableHttpUrl) - anything else would
  // persist as a value the product can never present as a reference. This
  // rejects it at the write boundary instead of storing a silently
  // degraded value; free-form notes belong in memo.
  if (sourceUrl !== null && !isRenderableHttpUrl(sourceUrl)) {
    fieldErrors.sourceUrl = 'http:// または https:// で始まるURLを入力してください。';
  }

  if (hasErrors(fieldErrors)) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    value: {
      title,
      venue: optionalText(readField(raw, 'venue')),
      sourceUrl,
      memo: optionalText(readField(raw, 'memo')),
    },
  };
}

export function parseOccurrence(raw: RawFormValues): ParseResult<OccurrenceInput> {
  const fieldErrors: FieldErrors = {};

  const rawStartsAt = readField(raw, 'startsAt').trim();
  let startsAtUtc: string | null = null;
  if (rawStartsAt.length === 0) {
    fieldErrors.startsAt = '開演日時を入力してください。';
  } else {
    startsAtUtc = tokyoDateTimeLocalToInstant(rawStartsAt);
    if (startsAtUtc === null) {
      fieldErrors.startsAt = '開演日時の形式が正しくありません。';
    }
  }

  // An unset end/doors time is a legitimate product state, so a blank value
  // is accepted as null here rather than reported as a missing field. Only
  // a value that is present but unparseable is an error.
  const rawEndsAt = readField(raw, 'endsAt').trim();
  let endsAtUtc: string | null = null;
  if (rawEndsAt.length > 0) {
    endsAtUtc = tokyoDateTimeLocalToInstant(rawEndsAt);
    if (endsAtUtc === null) {
      fieldErrors.endsAt = '終演日時の形式が正しくありません。';
    }
  }

  const rawDoorsAt = readField(raw, 'doorsAt').trim();
  let doorsAtUtc: string | null = null;
  if (rawDoorsAt.length > 0) {
    doorsAtUtc = tokyoDateTimeLocalToInstant(rawDoorsAt);
    if (doorsAtUtc === null) {
      fieldErrors.doorsAt = '開場日時の形式が正しくありません。';
    }
  }

  if (hasErrors(fieldErrors) || startsAtUtc === null) {
    return { ok: false, fieldErrors };
  }

  // Every time that parsed, so the ordering itself can be judged. This is
  // the single place every supported write path reaches - parseEventCreate
  // delegates here for the initial occurrence, and the add/update
  // occurrence actions call it directly - so the check cannot be bypassed
  // by using a different screen.
  //
  // Equal instants are accepted at each boundary: a zero-length occurrence,
  // or doors opening exactly at 開演, is odd but not self-contradictory,
  // and rejecting it would invent a rule the product does not have. Only a
  // value strictly *after* the next one in the doors <= starts <= ends
  // chain is refused.
  //
  // The database enforces the same ordering at commit
  // (event_occurrences_doors_at_le_starts_at /
  // event_occurrences_starts_at_le_ends_at, Issue #88), so this guards the
  // product's write paths ahead of that round trip rather than substituting
  // for it.
  if (doorsAtUtc !== null && Date.parse(doorsAtUtc) > Date.parse(startsAtUtc)) {
    return {
      ok: false,
      fieldErrors: { doorsAt: '開場日時は開演日時より後にできません。' },
    };
  }
  if (endsAtUtc !== null && Date.parse(endsAtUtc) < Date.parse(startsAtUtc)) {
    return {
      ok: false,
      fieldErrors: { endsAt: '終演日時は開演日時より前にできません。' },
    };
  }

  return { ok: true, value: { doorsAtUtc, startsAtUtc, endsAtUtc } };
}

/**
 * An event's occurrence sub-form left entirely blank (Issue #87/#88: the
 * initial occurrence on create is optional). Distinguished from a
 * partially-filled-but-invalid occurrence, which must still report its
 * field errors rather than being silently treated as "no occurrence
 * intended".
 */
function isBlankOccurrence(raw: RawFormValues): boolean {
  return (
    readField(raw, 'startsAt').trim().length === 0 &&
    readField(raw, 'endsAt').trim().length === 0 &&
    readField(raw, 'doorsAt').trim().length === 0
  );
}

export function parseEventRange(raw: RawFormValues): ParseResult<EventRangeInput> {
  const fieldErrors: FieldErrors = {};

  const startsOn = readField(raw, 'startsOn').trim();
  if (startsOn.length === 0) {
    fieldErrors.startsOn = '開催期間の開始日を入力してください。';
  } else {
    try {
      parseTokyoCalendarDate(startsOn);
    } catch {
      fieldErrors.startsOn = '開始日の形式が正しくありません。';
    }
  }

  const endsOn = readField(raw, 'endsOn').trim();
  if (endsOn.length === 0) {
    fieldErrors.endsOn = '開催期間の終了日を入力してください。';
  } else {
    try {
      parseTokyoCalendarDate(endsOn);
    } catch {
      fieldErrors.endsOn = '終了日の形式が正しくありません。';
    }
  }

  if (hasErrors(fieldErrors)) {
    return { ok: false, fieldErrors };
  }

  // events_starts_on_le_ends_on (Issue #88) enforces this at the database
  // too; checked here ahead of that round trip for the same reason as
  // parseOccurrence's ordering checks above.
  if (startsOn > endsOn) {
    return { ok: false, fieldErrors: { endsOn: '終了日は開始日より前にできません。' } };
  }

  return { ok: true, value: { startsOn, endsOn } };
}

/**
 * The occurrence/Event-range containment invariant (Issue #88:
 * event_occurrences_within_event_range / events_range_contains_occurrences
 * at the DB level), checked here ahead of that round trip so a violation
 * is reported at the startsAt field instead of a generic "保存できません
 * でした" banner. Deliberately not folded into parseOccurrence itself:
 * that parser has no way to know its caller's parent event range (it is a
 * generic per-occurrence parser, reused by contexts that do and do not
 * have one in scope yet), so this is a separate step a caller runs once
 * both an occurrence and a range are available - parseEventCreate below
 * for create, and the add/update occurrence actions (which already have
 * to read the parent event to reach this point) for existing events.
 */
export function validateOccurrenceWithinRange(
  occurrence: OccurrenceInput,
  range: EventRangeInput,
): FieldErrors {
  const occurrenceDate = tokyoCalendarDateFromInstant(occurrence.startsAtUtc);
  if (occurrenceDate < range.startsOn || occurrenceDate > range.endsOn) {
    return {
      startsAt: `開演日時は開催期間（${range.startsOn}〜${range.endsOn}）の範囲内で入力してください。`,
    };
  }
  return {};
}

/**
 * A create submission carries the event's descriptive fields, its Event
 * range, and (optionally) an initial occurrence; all are parsed so a form
 * can report every field's problem in one pass instead of surfacing the
 * event fields' errors, then the range's, then the occurrence's, across
 * repeated attempts.
 *
 * The occurrence sub-form is optional (Issue #87/#88): left entirely blank,
 * it parses to `initialOccurrence: null` rather than an error - the
 * opposite of the pre-#88 contract, where an occurrence was mandatory. A
 * partially-filled, invalid occurrence still reports its own field errors;
 * only a fully blank one is read as "no occurrence yet".
 */
export function parseEventCreate(raw: RawFormValues): ParseResult<EventCreateInput> {
  const details = parseEventDetails(raw);
  const range = parseEventRange(raw);
  const occurrenceBlank = isBlankOccurrence(raw);
  const occurrence = occurrenceBlank ? null : parseOccurrence(raw);

  if (!details.ok || !range.ok || (occurrence !== null && !occurrence.ok)) {
    return {
      ok: false,
      fieldErrors: {
        ...(details.ok ? {} : details.fieldErrors),
        ...(range.ok ? {} : range.fieldErrors),
        ...(occurrence === null || occurrence.ok ? {} : occurrence.fieldErrors),
      },
    };
  }

  // Every field parsed on its own, so the cross-field containment
  // invariant can finally be judged (Issue #88) - the same check the DB
  // performs, run here so a violation lands on the startsAt field instead
  // of surfacing only as a generic DB-error banner after a round trip.
  if (occurrence !== null) {
    const containmentErrors = validateOccurrenceWithinRange(occurrence.value, range.value);
    if (hasErrors(containmentErrors)) {
      return { ok: false, fieldErrors: containmentErrors };
    }
  }

  return {
    ok: true,
    value: {
      details: details.value,
      range: range.value,
      initialOccurrence: occurrence === null ? null : occurrence.value,
    },
  };
}

/**
 * Renders already-persisted values back into the string shape a form's
 * inputs take.
 *
 * Used from two directions that must not drift apart: an edit screen
 * pre-filling from what was read, and a completed write echoing what was
 * actually stored. The second matters because the parse step trims and
 * maps blanks to null - echoing the raw submission instead would leave a
 * form showing "  Title  " under a message saying "Title" was saved.
 *
 * null becomes an empty string rather than being omitted: an unset
 * optional field must clear the input, not leave the previous value in it.
 */
export function eventDetailsToFormValues(details: EventDetailsInput): RawFormValues {
  return {
    title: details.title,
    venue: details.venue ?? '',
    sourceUrl: details.sourceUrl ?? '',
    memo: details.memo ?? '',
  };
}

/**
 * The occurrence counterpart. Instants go back through the same Asia/Tokyo
 * conversion the form's values came in on, so a value that round-trips
 * through the database lands on the same wall clock it was entered as.
 */
export function occurrenceToFormValues(occurrence: OccurrenceInput): RawFormValues {
  return {
    doorsAt:
      occurrence.doorsAtUtc === null ? '' : tokyoDateTimeLocalFromInstant(occurrence.doorsAtUtc),
    startsAt: tokyoDateTimeLocalFromInstant(occurrence.startsAtUtc),
    endsAt:
      occurrence.endsAtUtc === null ? '' : tokyoDateTimeLocalFromInstant(occurrence.endsAtUtc),
  };
}

/** The Event range counterpart - startsOn/endsOn are already
 * "YYYY-MM-DD" strings, the same shape a `date` input's value takes, so no
 * conversion is needed. */
export function eventRangeToFormValues(range: EventRangeInput): RawFormValues {
  return { startsOn: range.startsOn, endsOn: range.endsOn };
}

/**
 * Why a write failed, in the terms docs/ux-ui.md's "Common states"
 * requires a UI to distinguish. A permission denial must never be rendered
 * as a generic failure (or, worse, as success), so it is classified from
 * the database's own error code rather than by matching message text.
 *
 * 'duplicate-occurrence' is its own kind rather than folding into
 * 'validation': it names a specific, submittable-again-with-a-different-
 * value field problem (Issue #79's (event_id, starts_at) uniqueness), not
 * a generic "check your input" failure, so a caller can point the error at
 * the startsAt field instead of showing a banner.
 */
export type EventCatalogWriteErrorKind =
  'permission-denied' | 'validation' | 'duplicate-occurrence' | 'failure';

export interface EventCatalogWriteError {
  kind: EventCatalogWriteErrorKind;
  message: string;
  code: string;
}

export type EventCatalogWriteResult<T> =
  { ok: true; data: T } | { ok: false; error: EventCatalogWriteError };

/** insufficient_privilege: raised by the create RPC's designated-creator
 * check, and by RLS WITH CHECK / missing column-privilege denials. */
const INSUFFICIENT_PRIVILEGE = '42501';

/** Constraint and data-format violations the database rejects: NOT NULL,
 * CHECK, foreign key, and invalid datetime input. These mean the submitted
 * values are wrong, not that the caller lacked permission. */
const VALIDATION_CODES = new Set(['23502', '23503', '23514', '22007', '22008', '22P02']);

/** unique_violation. Within this write boundary's tables, the only unique
 * constraint an authenticated client can ever hit is
 * event_occurrences_event_id_starts_at_key (Issue #79):
 * events.source_key carries its own unique index, but authenticated has no
 * INSERT/UPDATE grant on that column at all. So this code alone identifies
 * the violation without parsing the constraint name out of the message. */
const UNIQUE_VIOLATION = '23505';

export function classifyWriteError(error: RawPostgrestError): EventCatalogWriteError {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return { kind: 'permission-denied', message: error.message, code: error.code };
  }
  if (error.code === UNIQUE_VIOLATION) {
    return { kind: 'duplicate-occurrence', message: error.message, code: error.code };
  }
  if (VALIDATION_CODES.has(error.code)) {
    return { kind: 'validation', message: error.message, code: error.code };
  }
  return { kind: 'failure', message: error.message, code: error.code };
}
