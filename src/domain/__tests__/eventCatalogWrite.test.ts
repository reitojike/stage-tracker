import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eventDetailsToFormValues,
  occurrenceToFormValues,
  classifyWriteError,
  parseEventCreate,
  parseEventDetails,
  parseEventRange,
  parseOccurrence,
  tokyoDateTimeLocalFromInstant,
  tokyoDateTimeLocalToInstant,
} from '../eventCatalogWrite.ts';

// --- Tokyo wall clock <-> UTC instant ---

void test('tokyoDateTimeLocalToInstant reads a datetime-local value as Asia/Tokyo, not UTC', () => {
  assert.equal(tokyoDateTimeLocalToInstant('2026-08-22T19:00'), '2026-08-22T10:00:00.000Z');
});

void test('tokyoDateTimeLocalToInstant crosses the date boundary correctly', () => {
  // Tokyo 08:30 is the previous UTC day.
  assert.equal(tokyoDateTimeLocalToInstant('2026-01-01T08:30'), '2025-12-31T23:30:00.000Z');
});

void test('tokyoDateTimeLocalToInstant accepts an optional seconds component', () => {
  assert.equal(tokyoDateTimeLocalToInstant('2026-08-22T19:00:45'), '2026-08-22T10:00:45.000Z');
});

// The whole point of the fixed-offset arithmetic: the result must not
// depend on the machine's timezone, which `new Date('2026-08-22T19:00')`
// would silently apply.
void test('tokyoDateTimeLocalToInstant does not depend on the runtime local timezone', () => {
  const naive = new Date('2026-08-22T19:00').toISOString();
  const tokyo = tokyoDateTimeLocalToInstant('2026-08-22T19:00');
  assert.equal(tokyo, '2026-08-22T10:00:00.000Z');
  if (new Date().getTimezoneOffset() !== -540) {
    assert.notEqual(tokyo, naive);
  }
});

void test('tokyoDateTimeLocalToInstant rejects a malformed value', () => {
  assert.equal(tokyoDateTimeLocalToInstant(''), null);
  assert.equal(tokyoDateTimeLocalToInstant('2026-08-22'), null);
  assert.equal(tokyoDateTimeLocalToInstant('yesterday'), null);
});

void test('tokyoDateTimeLocalToInstant rejects a non-existent calendar date', () => {
  assert.equal(tokyoDateTimeLocalToInstant('2026-02-30T10:00'), null);
  assert.equal(tokyoDateTimeLocalToInstant('2026-13-01T10:00'), null);
});

// Date.UTC would roll 25:00 into the next day rather than rejecting it.
void test('tokyoDateTimeLocalToInstant rejects out-of-range time components', () => {
  assert.equal(tokyoDateTimeLocalToInstant('2026-08-22T25:00'), null);
  assert.equal(tokyoDateTimeLocalToInstant('2026-08-22T10:75'), null);
});

void test('tokyoDateTimeLocalFromInstant round-trips a Tokyo wall clock value', () => {
  const original = '2026-08-22T19:00';
  const instant = tokyoDateTimeLocalToInstant(original);
  assert.ok(instant);
  assert.equal(tokyoDateTimeLocalFromInstant(instant), original);
});

void test('tokyoDateTimeLocalFromInstant renders the Tokyo day for a late-UTC instant', () => {
  assert.equal(tokyoDateTimeLocalFromInstant('2025-12-31T23:30:00.000Z'), '2026-01-01T08:30');
});

// --- Event descriptive fields ---

void test('parseEventDetails trims and keeps a valid submission', () => {
  const result = parseEventDetails({
    title: '  ある公演  ',
    venue: ' 帝国劇場 ',
    sourceUrl: ' https://example.test/info ',
    memo: ' 座席未定 ',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    title: 'ある公演',
    venue: '帝国劇場',
    sourceUrl: 'https://example.test/info',
    memo: '座席未定',
  });
});

// product-rules.md treats "not set" as a legitimate state for these
// fields, so a blank input must persist as NULL, not as an empty string
// that would read back as a set value.
void test('parseEventDetails maps blank optional fields to null, not empty strings', () => {
  const result = parseEventDetails({
    title: 'タイトルのみ',
    venue: '   ',
    sourceUrl: '',
    memo: '',
  });
  assert.ok(result.ok);
  assert.equal(result.value.venue, null);
  assert.equal(result.value.sourceUrl, null);
  assert.equal(result.value.memo, null);
});

void test('parseEventDetails treats missing optional keys as unset', () => {
  const result = parseEventDetails({ title: 'タイトルのみ' });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    title: 'タイトルのみ',
    venue: null,
    sourceUrl: null,
    memo: null,
  });
});

void test('parseEventDetails requires a title', () => {
  const result = parseEventDetails({ title: '   ' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.title);
});

void test('parseEventDetails rejects a non-http(s) reference URL', () => {
  const result = parseEventDetails({ title: 'ある公演', sourceUrl: 'javascript:alert(1)' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.sourceUrl);
});

void test('parseEventDetails rejects a reference URL that is not a URL at all', () => {
  const result = parseEventDetails({ title: 'ある公演', sourceUrl: '公式サイト参照' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.sourceUrl);
});

// --- Occurrence times ---

void test('parseOccurrence converts every time from Tokyo wall clock', () => {
  const result = parseOccurrence({
    doorsAt: '2026-08-22T10:30',
    startsAt: '2026-08-22T11:00',
    endsAt: '2026-08-22T14:30',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    doorsAtUtc: '2026-08-22T01:30:00.000Z',
    startsAtUtc: '2026-08-22T02:00:00.000Z',
    endsAtUtc: '2026-08-22T05:30:00.000Z',
  });
});

void test('parseOccurrence accepts an unset doors time as null', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T11:00' });
  assert.ok(result.ok);
  assert.equal(result.value.doorsAtUtc, null);
});

void test('parseOccurrence rejects doors after starts', () => {
  const result = parseOccurrence({ doorsAt: '2026-08-22T12:00', startsAt: '2026-08-22T11:00' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.doorsAt);
});

// An unknown end time is a valid product state and must never be coerced
// into a fabricated default.
void test('parseOccurrence accepts an unset end time as null', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T11:00', endsAt: '' });
  assert.ok(result.ok);
  assert.equal(result.value.endsAtUtc, null);
});

void test('parseOccurrence requires a start time', () => {
  const result = parseOccurrence({ endsAt: '2026-08-22T14:30' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.startsAt);
});

void test('parseOccurrence reports a malformed start time distinctly from a missing one', () => {
  const missing = parseOccurrence({ startsAt: '' });
  const malformed = parseOccurrence({ startsAt: '2026-02-30T11:00' });
  assert.ok(!missing.ok);
  assert.ok(!malformed.ok);
  assert.notEqual(missing.fieldErrors.startsAt, malformed.fieldErrors.startsAt);
});

void test('parseOccurrence rejects a present but malformed end time', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T11:00', endsAt: 'あとで' });
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.endsAt);
});

// --- Event range: endsOn (Issue #91: optional on create, still required on edit) ---

void test('parseEventRange requires endsOn by default - the Event range edit path is unaffected by #91', () => {
  const result = parseEventRange({ startsOn: '2026-08-01', endsOn: '' });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.endsOn);
});

void test('parseEventRange normalizes a blank endsOn to startsOn when allowBlankEndsOn is set', () => {
  const result = parseEventRange(
    { startsOn: '2026-08-01', endsOn: '' },
    { allowBlankEndsOn: true },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.value, { startsOn: '2026-08-01', endsOn: '2026-08-01' });
});

void test('parseEventRange still enforces startsOn <= endsOn for an explicit endsOn even when allowBlankEndsOn is set', () => {
  const result = parseEventRange(
    { startsOn: '2026-08-10', endsOn: '2026-08-01' },
    { allowBlankEndsOn: true },
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.endsOn);
});

void test('parseEventRange rejects a malformed explicit endsOn even when allowBlankEndsOn is set', () => {
  const result = parseEventRange(
    { startsOn: '2026-08-10', endsOn: 'not-a-date' },
    { allowBlankEndsOn: true },
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.endsOn);
});

// --- Combined create submission ---

// Issue #91: create's endsOn is optional - a blank value normalizes to
// startsOn (the canonical single-day representation), matching what
// parseEventRange does with allowBlankEndsOn.
void test('parseEventCreate normalizes a blank endsOn to startsOn', () => {
  const result = parseEventCreate({
    title: 'ある公演',
    startsOn: '2026-08-01',
    endsOn: '',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value.range, { startsOn: '2026-08-01', endsOn: '2026-08-01' });
});

// An explicit multi-day endsOn on create must not regress (Issue #91 "In
// scope"/"Out of scope": the simplification only widens what create
// accepts, it never changes how an explicit value is handled).
void test('parseEventCreate keeps an explicit multi-day endsOn as submitted', () => {
  const result = parseEventCreate({
    title: 'ある公演',
    startsOn: '2026-08-01',
    endsOn: '2026-08-05',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.value.range, { startsOn: '2026-08-01', endsOn: '2026-08-05' });
});

void test('parseEventCreate returns all three parts of a valid submission with an initial occurrence', () => {
  const result = parseEventCreate({
    title: 'ある公演',
    venue: '帝国劇場',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    startsAt: '2026-08-22T11:00',
  });
  assert.ok(result.ok);
  assert.equal(result.value.details.title, 'ある公演');
  assert.deepEqual(result.value.range, { startsOn: '2026-08-01', endsOn: '2026-08-31' });
  assert.ok(result.value.initialOccurrence);
  assert.equal(result.value.initialOccurrence.startsAtUtc, '2026-08-22T02:00:00.000Z');
  assert.equal(result.value.initialOccurrence.endsAtUtc, null);
});

// Issue #87/#88: an event may be created with zero occurrences. Leaving the
// occurrence sub-form entirely blank must parse to initialOccurrence: null,
// not an error - the range fields are still required.
void test('parseEventCreate accepts a fully blank occurrence sub-form as no initial occurrence', () => {
  const result = parseEventCreate({
    title: 'ある公演',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
  });
  assert.ok(result.ok);
  assert.equal(result.value.initialOccurrence, null);
});

// A partially-filled occurrence (e.g. only endsAt) is not "blank" - it must
// still report its own field errors rather than being silently discarded.
void test('parseEventCreate reports a partially-filled invalid occurrence, not treat it as blank', () => {
  const result = parseEventCreate({
    title: 'ある公演',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    endsAt: '2026-08-22T14:30',
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.startsAt);
});

// Reporting only the event fields first, then the range's, then the
// occurrence's, across repeated attempts would make a single bad submission
// take multiple round trips to fix.
void test('parseEventCreate reports event, range, and occurrence field errors together', () => {
  const result = parseEventCreate({ title: '', startsOn: '', endsAt: 'あとで' });
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.ok(result.fieldErrors.title);
  assert.ok(result.fieldErrors.startsOn);
  assert.ok(result.fieldErrors.endsAt);
});

// --- Write error classification ---

// A permission denial must be presented distinctly from a generic failure
// (docs/ux-ui.md "Common states"), and it is classified from the database's
// own error code, never by matching message text.
void test('classifyWriteError maps insufficient_privilege to permission-denied', () => {
  const error = classifyWriteError({
    code: '42501',
    message: 'event creation is restricted to designated catalog creators',
  });
  assert.equal(error.kind, 'permission-denied');
  assert.equal(error.code, '42501');
});

void test('classifyWriteError maps constraint violations to validation', () => {
  assert.equal(classifyWriteError({ code: '23502', message: 'null value' }).kind, 'validation');
  assert.equal(classifyWriteError({ code: '23503', message: 'fk' }).kind, 'validation');
  assert.equal(classifyWriteError({ code: '22007', message: 'bad datetime' }).kind, 'validation');
});

// Issue #79: event_occurrences_event_id_starts_at_key's unique_violation is
// its own kind, not folded into 'validation' - a caller needs to tell it
// apart to report it at the startsAt field instead of a generic banner.
void test('classifyWriteError maps unique_violation to duplicate-occurrence', () => {
  const error = classifyWriteError({
    code: '23505',
    message:
      'duplicate key value violates unique constraint "event_occurrences_event_id_starts_at_key"',
  });
  assert.equal(error.kind, 'duplicate-occurrence');
  assert.equal(error.code, '23505');
});

void test('classifyWriteError maps anything else to failure', () => {
  assert.equal(
    classifyWriteError({ code: '08006', message: 'connection failure' }).kind,
    'failure',
  );
  assert.equal(classifyWriteError({ code: 'PGRST202', message: 'not found' }).kind, 'failure');
});

void test('classifyWriteError preserves the original message and code', () => {
  const error = classifyWriteError({ code: '42501', message: 'denied' });
  assert.equal(error.message, 'denied');
  assert.equal(error.code, '42501');
});

void test('eventDetailsToFormValues renders unset optional fields as empty strings', () => {
  // Not omitted: an input left out of the values object would keep whatever
  // the previous render put in it, so clearing a field would not stick.
  assert.deepEqual(
    eventDetailsToFormValues({ title: 'Title', venue: null, sourceUrl: null, memo: null }),
    { title: 'Title', venue: '', sourceUrl: '', memo: '' },
  );
});

void test('a parsed event round-trips back to the values a form would show', () => {
  const parsed = parseEventDetails({
    title: '  Trimmed Title  ',
    venue: '   ',
    sourceUrl: 'https://example.test/show',
    memo: ' note ',
  });
  assert.ok(parsed.ok);

  // The point of the round trip: what the form shows after a save is what
  // was persisted, not the untrimmed text that was typed.
  assert.deepEqual(eventDetailsToFormValues(parsed.value), {
    title: 'Trimmed Title',
    venue: '',
    sourceUrl: 'https://example.test/show',
    memo: 'note',
  });
});

void test('an occurrence round-trips through the database shape onto the same wall clock', () => {
  const parsed = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '2026-08-22T21:30' });
  assert.ok(parsed.ok);

  assert.deepEqual(occurrenceToFormValues(parsed.value), {
    doorsAt: '',
    startsAt: '2026-08-22T19:00',
    endsAt: '2026-08-22T21:30',
  });
});

void test('an unset end/doors time round-trips as an empty input, not as a fabricated time', () => {
  const parsed = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '' });
  assert.ok(parsed.ok);

  assert.deepEqual(occurrenceToFormValues(parsed.value), {
    doorsAt: '',
    startsAt: '2026-08-22T19:00',
    endsAt: '',
  });
});

void test('a past-midnight occurrence round-trips onto the following Tokyo day', () => {
  const parsed = parseOccurrence({ startsAt: '2026-08-22T22:00', endsAt: '2026-08-23T01:00' });
  assert.ok(parsed.ok);

  assert.deepEqual(occurrenceToFormValues(parsed.value), {
    doorsAt: '',
    startsAt: '2026-08-22T22:00',
    endsAt: '2026-08-23T01:00',
  });
});

void test('parseOccurrence rejects an end that precedes its start', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '2026-08-22T18:00' });
  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors.endsAt);
  // Reported on 終演日時, the field the owner has to change - not as a
  // whole-form failure they have to work out for themselves.
  assert.equal(result.fieldErrors.startsAt, undefined);
});

void test('parseOccurrence rejects an end on an earlier day', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '2026-08-21T23:00' });
  assert.equal(result.ok, false);
});

void test('parseOccurrence accepts an end equal to its start', () => {
  // A zero-length occurrence is odd but not self-contradictory, and the
  // product has no rule against it.
  const result = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '2026-08-22T19:00' });
  assert.equal(result.ok, true);
});

void test('parseOccurrence still accepts a performance running past midnight', () => {
  // The guard must not mistake "next calendar day" for "before the start".
  const result = parseOccurrence({ startsAt: '2026-08-22T22:00', endsAt: '2026-08-23T01:00' });
  assert.equal(result.ok, true);
});

void test('parseOccurrence still treats an unset end as valid', () => {
  const result = parseOccurrence({ startsAt: '2026-08-22T19:00', endsAt: '' });
  assert.equal(result.ok, true);
});

void test('the create path rejects a reversed interval too', () => {
  // parseEventCreate delegates to parseOccurrence, so the initial
  // occurrence is guarded by the same boundary as a later one.
  const result = parseEventCreate({
    title: 'Show',
    startsAt: '2026-08-22T19:00',
    endsAt: '2026-08-22T18:00',
  });
  assert.equal(result.ok, false);
  assert.ok(result.fieldErrors.endsAt);
});

void test('a reversed interval is reported alongside the event fields errors', () => {
  const result = parseEventCreate({
    title: '',
    startsAt: '2026-08-22T19:00',
    endsAt: '2026-08-22T18:00',
  });
  assert.equal(result.ok, false);
  // One pass, both problems: the owner should not fix the title only to be
  // told about the times on the next attempt.
  assert.ok(result.fieldErrors.title);
  assert.ok(result.fieldErrors.endsAt);
});
