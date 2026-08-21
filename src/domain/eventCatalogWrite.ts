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
import { parseTokyoCalendarDate, type RawPostgrestError } from './eventCatalog.ts';

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Descriptive event fields an owner may set. Excludes owner_id and every
 * system-managed field, which no client may write at all. */
export interface EventDetailsInput {
  title: string;
  venue: string | null;
  sourceUrl: string | null;
  memo: string | null;
}

export interface OccurrenceInput {
  startsAtUtc: string;
  endsAtUtc: string | null;
}

/** An event and the initial occurrence it must be created with - the two
 * halves the create RPC persists atomically. */
export interface EventCreateInput {
  details: EventDetailsInput;
  initialOccurrence: OccurrenceInput;
}

export type EventWriteField = 'title' | 'venue' | 'sourceUrl' | 'memo' | 'startsAt' | 'endsAt';

export type FieldErrors = Partial<Record<EventWriteField, string>>;

/**
 * Field-level parse outcome. Errors are keyed by field so a form can put
 * each message next to the input it belongs to, rather than collapsing
 * every problem into one banner.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; fieldErrors: FieldErrors };

function hasErrors(fieldErrors: FieldErrors): boolean {
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

  // An unset end time is a legitimate product state, so a blank value is
  // accepted as null here rather than reported as a missing field. Only a
  // value that is present but unparseable is an error.
  const rawEndsAt = readField(raw, 'endsAt').trim();
  let endsAtUtc: string | null = null;
  if (rawEndsAt.length > 0) {
    endsAtUtc = tokyoDateTimeLocalToInstant(rawEndsAt);
    if (endsAtUtc === null) {
      fieldErrors.endsAt = '終演日時の形式が正しくありません。';
    }
  }

  if (hasErrors(fieldErrors) || startsAtUtc === null) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, value: { startsAtUtc, endsAtUtc } };
}

/**
 * A create submission carries both halves; both are parsed so a form can
 * report every field's problem in one pass instead of surfacing the event
 * fields' errors, then the occurrence's on the next attempt.
 */
export function parseEventCreate(raw: RawFormValues): ParseResult<EventCreateInput> {
  const details = parseEventDetails(raw);
  const occurrence = parseOccurrence(raw);

  if (!details.ok || !occurrence.ok) {
    return {
      ok: false,
      fieldErrors: {
        ...(details.ok ? {} : details.fieldErrors),
        ...(occurrence.ok ? {} : occurrence.fieldErrors),
      },
    };
  }

  return { ok: true, value: { details: details.value, initialOccurrence: occurrence.value } };
}

/**
 * Why a write failed, in the terms docs/ux-ui.md's "Common states"
 * requires a UI to distinguish. A permission denial must never be rendered
 * as a generic failure (or, worse, as success), so it is classified from
 * the database's own error code rather than by matching message text.
 */
export type EventCatalogWriteErrorKind = 'permission-denied' | 'validation' | 'failure';

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

export function classifyWriteError(error: RawPostgrestError): EventCatalogWriteError {
  if (error.code === INSUFFICIENT_PRIVILEGE) {
    return { kind: 'permission-denied', message: error.message, code: error.code };
  }
  if (VALIDATION_CODES.has(error.code)) {
    return { kind: 'validation', message: error.message, code: error.code };
  }
  return { kind: 'failure', message: error.message, code: error.code };
}
