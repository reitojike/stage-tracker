// Pure (no-DB) shape validation for the TicketOpportunity import seed
// format (Issue #163, over the #162 landed model).
//
// This module deliberately knows nothing about Supabase: it only checks
// that one seed entry is internally well-formed, the same split
// scripts/import-catalog-events.mjs's own validateEntry draws between "is
// this shaped correctly" (here) and "does it resolve against the current
// catalog" (scripts/lib/ticketOpportunityImport.mjs, which needs a DB
// client). Kept separate so the shape rules are unit-testable without a
// running Supabase instance.

export const HAS_UTC_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
export const HAS_CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Matches ticket_opportunity_milestones' own CHECK constraint
// (supabase/migrations/20260828000100_create_ticket_opportunity_milestones.sql)
// - kept in sync by hand since this script has no import of src/domain/*
// (see import-catalog-events.mjs's own module header for why).
export const MILESTONE_TYPES = new Set([
  'application_open',
  'application_close',
  'result_announcement',
  'sale_start',
  'payment_window',
]);

export const TEMPORAL_PRECISIONS = new Set(['date', 'datetime', 'window']);
export const TARGET_SCOPES = new Set(['event_wide', 'selected_occurrences']);

function text(value, field, required, problems) {
  if (value === null || value === undefined) {
    if (required) problems.push(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    problems.push(`${field} must be a non-empty string when present`);
    return null;
  }
  return value.trim();
}

/**
 * Validates one milestone entry's shape. temporal_precision gates exactly
 * which of date/at/startsAt+endsAt may be present, mirroring the DB CHECK
 * constraint that would otherwise reject an inconsistent row only at
 * --apply time - this catches the same mistake during dry-run review
 * instead (#163 "DB constraint violationまで待たず...operator dry run時に
 * 可能なものは明確なerror").
 */
function validateMilestone(raw, at, problems) {
  const type = text(raw?.type, `${at}.type`, true, problems);
  if (type !== null && !MILESTONE_TYPES.has(type)) {
    problems.push(`${at}.type must be one of: ${[...MILESTONE_TYPES].join(', ')}`);
  }
  const precision = text(raw?.precision, `${at}.precision`, true, problems);
  if (precision !== null && !TEMPORAL_PRECISIONS.has(precision)) {
    problems.push(`${at}.precision must be one of: ${[...TEMPORAL_PRECISIONS].join(', ')}`);
    return null;
  }
  // precision, if non-null here, is already known to be in
  // TEMPORAL_PRECISIONS - the guard above already returned for any other
  // case.
  if (type === null || precision === null) {
    return null;
  }

  const extraneous = (fields) => {
    for (const field of fields) {
      if (raw[field] !== undefined && raw[field] !== null) {
        problems.push(`${at}.${field} must not be set for precision "${precision}"`);
      }
    }
  };

  if (precision === 'date') {
    extraneous(['at', 'startsAt', 'endsAt']);
    const date = text(raw.date, `${at}.date`, true, problems);
    if (date !== null && !HAS_CALENDAR_DATE_SHAPE.test(date)) {
      problems.push(`${at}.date must be an Asia/Tokyo calendar date as "YYYY-MM-DD"`);
      return null;
    }
    if (date === null) return null;
    return { milestone_type: type, temporal_precision: precision, date_value: date };
  }

  if (precision === 'datetime') {
    extraneous(['date', 'startsAt', 'endsAt']);
    const atValue = text(raw.at, `${at}.at`, true, problems);
    if (atValue === null) return null;
    if (Number.isNaN(Date.parse(atValue))) {
      problems.push(`${at}.at must be a parseable timestamp`);
      return null;
    }
    // A source stating a bare "17:00" without a UTC offset would otherwise
    // be read as UTC here and land nine hours off, silently - the same
    // hazard import-catalog-events.mjs's own startsAt check exists to
    // close (#163 "datetimeにはexplicit offsetを要求").
    if (!HAS_UTC_OFFSET.test(atValue)) {
      problems.push(`${at}.at must carry an explicit UTC offset (e.g. +09:00)`);
      return null;
    }
    return { milestone_type: type, temporal_precision: precision, at: atValue };
  }

  // precision === 'window'
  extraneous(['date', 'at']);
  const startsAt = text(raw.startsAt, `${at}.startsAt`, true, problems);
  const endsAt = text(raw.endsAt, `${at}.endsAt`, true, problems);
  if (startsAt === null || endsAt === null) return null;
  const startsAtMs = Date.parse(startsAt);
  const endsAtMs = Date.parse(endsAt);
  if (Number.isNaN(startsAtMs)) {
    problems.push(`${at}.startsAt must be a parseable timestamp`);
    return null;
  }
  if (Number.isNaN(endsAtMs)) {
    problems.push(`${at}.endsAt must be a parseable timestamp`);
    return null;
  }
  if (!HAS_UTC_OFFSET.test(startsAt)) {
    problems.push(`${at}.startsAt must carry an explicit UTC offset (e.g. +09:00)`);
    return null;
  }
  if (!HAS_UTC_OFFSET.test(endsAt)) {
    problems.push(`${at}.endsAt must carry an explicit UTC offset (e.g. +09:00)`);
    return null;
  }
  if (endsAtMs < startsAtMs) {
    problems.push(`${at}.endsAt is earlier than ${at}.startsAt`);
    return null;
  }
  return {
    milestone_type: type,
    temporal_precision: precision,
    starts_at: startsAt,
    ends_at: endsAt,
  };
}

/**
 * Validates one seed entry's shape and returns a normalized form (still
 * unresolved against the DB - see resolveSeedEntry in
 * ticketOpportunityImport.mjs for the eventSourceKey ->
 * event id / targetOccurrences -> occurrence id step). Returns
 * `{ ok: true, entry }` or `{ ok: false, problems }`; never throws, so
 * callers (the CLI and unit tests) can collect problems across every entry
 * before failing the whole run (#163 "全seed validationをwrite前に完了").
 */
export function validateSeedEntryShape(raw, where) {
  const problems = [];

  const eventSourceKey = text(raw?.eventSourceKey, 'eventSourceKey', true, problems);
  const sourceKey = text(raw?.sourceKey, 'sourceKey', true, problems);
  const displayName = text(raw?.displayName, 'displayName', true, problems);
  const sourceUrl = text(raw?.sourceUrl, 'sourceUrl', false, problems);
  if (sourceUrl !== null && !/^https?:\/\//.test(sourceUrl)) {
    problems.push('sourceUrl must start with http:// or https://');
  }
  const memo = text(raw?.memo, 'memo', false, problems);

  const targetScope = text(raw?.targetScope, 'targetScope', true, problems);
  if (targetScope !== null && !TARGET_SCOPES.has(targetScope)) {
    problems.push(`targetScope must be one of: ${[...TARGET_SCOPES].join(', ')}`);
  }

  const rawTargetOccurrences = raw?.targetOccurrences;
  if (rawTargetOccurrences !== undefined && !Array.isArray(rawTargetOccurrences)) {
    problems.push('targetOccurrences must be an array when present');
  }
  const targetOccurrenceLocators = [];
  if (Array.isArray(rawTargetOccurrences)) {
    for (const [index, value] of rawTargetOccurrences.entries()) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        problems.push(`targetOccurrences[${index}] must be a non-empty string`);
        continue;
      }
      const trimmed = value.trim();
      if (Number.isNaN(Date.parse(trimmed))) {
        problems.push(`targetOccurrences[${index}] must be a parseable timestamp`);
        continue;
      }
      if (!HAS_UTC_OFFSET.test(trimmed)) {
        problems.push(
          `targetOccurrences[${index}] must carry an explicit UTC offset (e.g. +09:00)`,
        );
        continue;
      }
      targetOccurrenceLocators.push(trimmed);
    }
  }

  if (targetScope === 'event_wide' && targetOccurrenceLocators.length > 0) {
    problems.push('an event_wide opportunity must not list targetOccurrences');
  }
  if (targetScope === 'selected_occurrences' && targetOccurrenceLocators.length === 0) {
    problems.push(
      'a selected_occurrences opportunity requires at least one targetOccurrences entry',
    );
  }

  // Duplicate locators within one entry are deduplicated rather than
  // rejected - #163 "duplicate locatorを安全に処理", mirroring how
  // import_ticket_opportunity itself deduplicates p_occurrence_ids via
  // array_agg(distinct ...) rather than erroring on a repeated id.
  //
  // Deduplicated by parsed instant, not raw string: two differently
  // formatted locators for the same instant (e.g. "+09:00" vs the
  // equivalent "Z" notation) are the same occurrence and must collapse to
  // one, or resolvePlans/formatPlanReport would report an inflated,
  // misleading targetOccurrences count to the operator even though the
  // RPC itself would still resolve them to a single occurrence id.
  const seenInstants = new Set();
  const distinctLocators = [];
  for (const locator of targetOccurrenceLocators) {
    const instant = Date.parse(locator);
    if (seenInstants.has(instant)) continue;
    seenInstants.add(instant);
    distinctLocators.push(locator);
  }

  const rawMilestones = raw?.milestones;
  if (rawMilestones !== undefined && !Array.isArray(rawMilestones)) {
    problems.push('milestones must be an array when present');
  }
  const milestones = [];
  const seenMilestoneTypes = new Set();
  if (Array.isArray(rawMilestones)) {
    for (const [index, rawMilestone] of rawMilestones.entries()) {
      const parsed = validateMilestone(rawMilestone, `milestones[${index}]`, problems);
      if (parsed === null) continue;
      // unique(opportunity_id, milestone_type) - see
      // 20260828000100_create_ticket_opportunity_milestones.sql. Caught
      // here rather than left to surface as a DB unique_violation only at
      // --apply time.
      if (seenMilestoneTypes.has(parsed.milestone_type)) {
        problems.push(
          `milestones[${index}]: duplicate milestone type "${parsed.milestone_type}" in the same opportunity`,
        );
        continue;
      }
      seenMilestoneTypes.add(parsed.milestone_type);
      milestones.push(parsed);
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems: problems.map((problem) => `${where}: ${problem}`) };
  }

  return {
    ok: true,
    entry: {
      eventSourceKey,
      sourceKey,
      displayName,
      sourceUrl,
      memo,
      targetScope,
      targetOccurrences: distinctLocators,
      milestones,
    },
  };
}
