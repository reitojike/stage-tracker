// Shared official Event import core (Issue #627).
//
// This module deliberately has no argv, filesystem, process-exit, console,
// credential-resolution, or source-fetch concerns. Callers provide reviewed
// entries and an already-authenticated admin client, then receive structured
// validation, resolution, plan, report, and apply results.

import {
  findConflictingGroupDefinitions,
  validateClassificationShape,
} from './eventClassificationSeed.mjs';
import {
  HAS_CALENDAR_DATE_SHAPE,
  HAS_UTC_OFFSET,
  isValidCalendarDateString,
  isValidCalendarDateTimeString,
} from './calendarDate.mjs';

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

function tokyoDateOf(instantIso) {
  const tokyo = new Date(Date.parse(instantIso) + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

export function validateEventEntry(raw, where = 'seed') {
  const problems = [];
  const sourceKey = text(raw?.sourceKey, 'sourceKey', true, problems);
  const title = text(raw?.title, 'title', true, problems);
  const venue = text(raw?.venue, 'venue', false, problems);
  const memo = text(raw?.memo, 'memo', false, problems);
  const sourceUrl = text(raw?.sourceUrl, 'sourceUrl', false, problems);
  if (sourceUrl !== null && !/^https?:\/\//.test(sourceUrl))
    problems.push('sourceUrl must start with http:// or https://');

  const startsOn = text(raw?.startsOn, 'startsOn', true, problems);
  const startsOnHasShape = startsOn !== null && HAS_CALENDAR_DATE_SHAPE.test(startsOn);
  const startsOnIsReal = startsOnHasShape && isValidCalendarDateString(startsOn);
  if (startsOn !== null && !startsOnHasShape)
    problems.push('startsOn must be an Asia/Tokyo calendar date as "YYYY-MM-DD"');
  else if (startsOnHasShape && !startsOnIsReal)
    problems.push('startsOn must be a real Asia/Tokyo calendar date');
  const endsOn = text(raw?.endsOn, 'endsOn', true, problems);
  const endsOnHasShape = endsOn !== null && HAS_CALENDAR_DATE_SHAPE.test(endsOn);
  const endsOnIsReal = endsOnHasShape && isValidCalendarDateString(endsOn);
  if (endsOn !== null && !endsOnHasShape)
    problems.push('endsOn must be an Asia/Tokyo calendar date as "YYYY-MM-DD"');
  else if (endsOnHasShape && !endsOnIsReal)
    problems.push('endsOn must be a real Asia/Tokyo calendar date');
  if (startsOn !== null && endsOn !== null && startsOnIsReal && endsOnIsReal && startsOn > endsOn)
    problems.push('endsOn must not be earlier than startsOn');

  const rawOccurrences = Array.isArray(raw?.occurrences) ? raw.occurrences : null;
  if (rawOccurrences === null) problems.push('occurrences must be an array (possibly empty)');
  const occurrences = [];
  const seenInstants = new Set();
  for (const [index, rawOccurrence] of (rawOccurrences ?? []).entries()) {
    const at = `occurrences[${index}]`;
    const startsAt =
      typeof rawOccurrence?.startsAt === 'string' ? Date.parse(rawOccurrence.startsAt) : Number.NaN;
    if (Number.isNaN(startsAt)) {
      problems.push(`${at}.startsAt must be a parseable timestamp`);
      continue;
    }
    if (!HAS_UTC_OFFSET.test(rawOccurrence.startsAt)) {
      problems.push(`${at}.startsAt must carry an explicit UTC offset (e.g. +09:00)`);
      continue;
    }
    if (!isValidCalendarDateTimeString(rawOccurrence.startsAt)) {
      problems.push(`${at}.startsAt must be a real calendar date/time`);
      continue;
    }
    if (seenInstants.has(startsAt)) {
      problems.push(`${at}.startsAt duplicates another occurrence in the same event`);
      continue;
    }
    seenInstants.add(startsAt);
    if (startsOn !== null && endsOn !== null) {
      const occurrenceDate = tokyoDateOf(rawOccurrence.startsAt);
      if (occurrenceDate < startsOn || occurrenceDate > endsOn) {
        problems.push(
          `${at}.startsAt (Asia/Tokyo date ${occurrenceDate}) is outside the event's range [${startsOn}, ${endsOn}]`,
        );
        continue;
      }
    }
    let endsAt = null;
    if (rawOccurrence.endsAt !== null && rawOccurrence.endsAt !== undefined) {
      const parsed =
        typeof rawOccurrence.endsAt === 'string' ? Date.parse(rawOccurrence.endsAt) : Number.NaN;
      if (Number.isNaN(parsed) || !HAS_UTC_OFFSET.test(rawOccurrence.endsAt)) {
        problems.push(`${at}.endsAt must be a parseable timestamp with an explicit UTC offset`);
        continue;
      }
      if (!isValidCalendarDateTimeString(rawOccurrence.endsAt)) {
        problems.push(`${at}.endsAt must be a real calendar date/time`);
        continue;
      }
      if (parsed < startsAt) {
        problems.push(`${at}.endsAt is earlier than startsAt`);
        continue;
      }
      endsAt = rawOccurrence.endsAt;
    }
    let doorsAt = null;
    if (rawOccurrence.doorsAt !== null && rawOccurrence.doorsAt !== undefined) {
      const parsed =
        typeof rawOccurrence.doorsAt === 'string' ? Date.parse(rawOccurrence.doorsAt) : Number.NaN;
      if (Number.isNaN(parsed) || !HAS_UTC_OFFSET.test(rawOccurrence.doorsAt)) {
        problems.push(`${at}.doorsAt must be a parseable timestamp with an explicit UTC offset`);
        continue;
      }
      if (!isValidCalendarDateTimeString(rawOccurrence.doorsAt)) {
        problems.push(`${at}.doorsAt must be a real calendar date/time`);
        continue;
      }
      if (parsed > startsAt) {
        problems.push(`${at}.doorsAt is later than startsAt`);
        continue;
      }
      doorsAt = rawOccurrence.doorsAt;
    }
    occurrences.push({ doorsAt, startsAt: rawOccurrence.startsAt, endsAt, instant: startsAt });
  }

  const classificationResult = validateClassificationShape(raw);
  let classification = { genre: undefined, groups: undefined };
  if (!classificationResult.ok) problems.push(...classificationResult.problems);
  else classification = classificationResult.classification;
  if (problems.length > 0)
    return {
      ok: false,
      problems: [`${where}: invalid seed entry`, ...problems.map((problem) => `  - ${problem}`)],
    };
  return {
    ok: true,
    entry: {
      sourceKey,
      title,
      venue,
      memo,
      sourceUrl,
      startsOn,
      endsOn,
      occurrences,
      classification,
    },
  };
}

export function validateEventEntries(rawEntries) {
  const problems = [];
  const entries = [];
  for (const { raw, where } of rawEntries) {
    const result = validateEventEntry(raw, where);
    if (result.ok) entries.push(result.entry);
    else problems.push(...result.problems);
  }
  if (problems.length > 0) return { ok: false, problems };
  const duplicateKeys = entries
    .map((entry) => entry.sourceKey)
    .filter((key, index, all) => all.indexOf(key) !== index);
  if (duplicateKeys.length > 0)
    return {
      ok: false,
      problems: [
        `Duplicate sourceKey across seed files: ${[...new Set(duplicateKeys)].join(', ')}`,
      ],
    };
  const groupConflicts = findConflictingGroupDefinitions(entries);
  if (groupConflicts.length > 0)
    return {
      ok: false,
      problems: [
        'Conflicting group definitions in this import run:',
        ...groupConflicts.map((problem) => `  - ${problem}`),
      ],
    };
  return { ok: true, entries };
}

function planGenre(entry, currentGenreId, genresByKey, genresById) {
  if (entry.classification.genre === undefined) {
    const current = currentGenreId === null ? null : (genresById.get(currentGenreId) ?? null);
    return { setGenre: false, genreKey: null, changed: false, current, proposed: current };
  }
  const genreKey = entry.classification.genre;
  if (genreKey !== null && !genresByKey.has(genreKey))
    return {
      ok: false,
      problem: `${entry.sourceKey}: unknown genre key "${genreKey}" (known genres: ${[...genresByKey.keys()].join(', ')})`,
    };
  const proposed = genreKey === null ? null : genresByKey.get(genreKey);
  const current = currentGenreId === null ? null : (genresById.get(currentGenreId) ?? null);
  return {
    setGenre: true,
    genreKey,
    changed: (current?.id ?? null) !== (proposed?.id ?? null),
    current,
    proposed,
  };
}

function planGroups(entry, currentGroups) {
  if (entry.classification.groups === undefined)
    return {
      setGroups: false,
      groups: [],
      changed: false,
      current: currentGroups,
      added: [],
      removed: [],
      renamed: [],
    };
  const proposed = entry.classification.groups;
  const currentByKey = new Map(currentGroups.map((group) => [group.key, group]));
  const proposedKeys = new Set(proposed.map((group) => group.key));
  const added = proposed.filter((group) => !currentByKey.has(group.key));
  const removed = currentGroups.filter((group) => !proposedKeys.has(group.key));
  const renamed = proposed.flatMap((group) => {
    const current = currentByKey.get(group.key);
    return current !== undefined && current.displayName !== group.displayName
      ? [
          {
            key: group.key,
            displayName: group.displayName,
            previousDisplayName: current.displayName,
          },
        ]
      : [];
  });
  return {
    setGroups: true,
    groups: proposed,
    changed: added.length > 0 || removed.length > 0 || renamed.length > 0,
    current: currentGroups,
    added,
    removed,
    renamed,
  };
}

const REVIEWED_EVENT_PAGE_SIZE = 500;
const MAX_REVIEWED_EVENT_ROWS = 5_000;

async function readCurrentEventRows(admin, table, columns, eventId, orderColumn) {
  const rows = [];
  for (let start = 0; start <= MAX_REVIEWED_EVENT_ROWS; start += REVIEWED_EVENT_PAGE_SIZE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq('event_id', eventId)
      .order(orderColumn)
      .range(start, start + REVIEWED_EVENT_PAGE_SIZE - 1);
    if (error)
      return {
        ok: false,
        problem: `Failed to read ${table} for event ${eventId}: ${error.message}`,
      };
    if (!Array.isArray(data))
      return { ok: false, problem: `Failed to read ${table} completely for event ${eventId}.` };
    if (rows.length + data.length > MAX_REVIEWED_EVENT_ROWS)
      return { ok: false, problem: `${table} exceeds the reviewed Event match-fact limit.` };
    rows.push(...data);
    if (data.length < REVIEWED_EVENT_PAGE_SIZE) return { ok: true, rows };
  }
  return { ok: false, problem: `${table} exceeds the reviewed Event match-fact limit.` };
}

async function fetchCurrentGroups(admin, eventId) {
  const result = await readCurrentEventRows(
    admin,
    'event_groups',
    'group_id, groups(key, display_name)',
    eventId,
    'group_id',
  );
  if (!result.ok) return result;
  return {
    ok: true,
    groups: result.rows
      .filter((row) => row.groups !== null)
      .map((row) => ({ key: row.groups.key, displayName: row.groups.display_name })),
  };
}

export async function resolveEventPlans(
  admin,
  entries,
  { owner, ownerEmail, remote = false, targetEventIdsBySourceKey = new Map() } = {},
) {
  if (owner === undefined || typeof owner?.id !== 'string')
    return { ok: false, problems: ['An owner with a valid id is required to plan Event imports.'] };
  const { data: creatorRow, error: creatorError } = await admin
    .from('catalog_creators')
    .select('user_id')
    .eq('user_id', owner.id)
    .maybeSingle();
  if (creatorError)
    return {
      ok: false,
      problems: [`Failed to check catalog creator membership: ${creatorError.message}`],
    };
  if (creatorRow === null)
    return {
      ok: false,
      problems: [
        `${ownerEmail ?? owner.id} is not a designated catalog creator. Grant it first: npm run catalog:grant-creator ${ownerEmail ?? owner.id}${remote ? ' -- --remote' : ''}`,
      ],
    };
  const { data: genreRows, error: genresError } = await admin
    .from('genres')
    .select('id, key, display_name');
  if (genresError)
    return { ok: false, problems: [`Failed to read genres: ${genresError.message}`] };
  const genresByKey = new Map(genreRows.map((row) => [row.key, row]));
  const genresById = new Map(genreRows.map((row) => [row.id, row]));
  const proposedGroupKeys = [
    ...new Set(
      entries.flatMap((entry) => (entry.classification.groups ?? []).map((group) => group.key)),
    ),
  ];
  const { data: canonicalGroups, error: groupsError } =
    proposedGroupKeys.length === 0
      ? { data: [], error: null }
      : await admin.from('groups').select('key, display_name').in('key', proposedGroupKeys);
  if (groupsError)
    return { ok: false, problems: [`Failed to read canonical groups: ${groupsError.message}`] };
  const canonicalGroupByKey = new Map(canonicalGroups.map((group) => [group.key, group]));
  const plans = [];

  for (const entry of entries) {
    const expectedProposedGroups = (entry.classification.groups ?? []).map((group) => ({
      key: group.key,
      displayName: canonicalGroupByKey.get(group.key)?.display_name ?? null,
    }));
    const targetEventId = targetEventIdsBySourceKey.get(entry.sourceKey);
    const existingQuery = admin
      .from('events')
      .select(
        'id, source_key, title, venue, source_url, memo, owner_id, starts_on, ends_on, genre_id, canceled_at',
      );
    const { data: existing, error } = await existingQuery
      .eq(targetEventId === undefined ? 'source_key' : 'id', targetEventId ?? entry.sourceKey)
      .maybeSingle();
    if (error)
      return { ok: false, problems: [`Failed to look up ${entry.sourceKey}: ${error.message}`] };
    if (existing === null) {
      const genrePlan = planGenre(entry, null, genresByKey, genresById);
      if (genrePlan.ok === false) return { ok: false, problems: [genrePlan.problem] };
      plans.push({
        entry,
        action: 'create',
        event: null,
        expectedCurrent: null,
        expectedProposedGroups,
        detailsChanged: false,
        rangeChanged: false,
        newOccurrences: entry.occurrences,
        endsAtFixes: [],
        doorsAtFixes: [],
        keptOccurrences: 0,
        genrePlan,
        groupsPlan: planGroups(entry, []),
      });
      continue;
    }
    if (existing.owner_id !== owner.id)
      return {
        ok: false,
        problems: [
          `${entry.sourceKey} already exists and is owned by ${existing.owner_id}, not ${ownerEmail ?? owner.id} (${owner.id}). Refusing to touch it.`,
        ],
      };
    const occurrenceResult = await readCurrentEventRows(
      admin,
      'event_occurrences',
      'id, doors_at, starts_at, ends_at, canceled_at',
      existing.id,
      'id',
    );
    if (!occurrenceResult.ok)
      return {
        ok: false,
        problems: [occurrenceResult.problem],
      };
    const existingOccurrences = occurrenceResult.rows;
    const byInstant = new Map();
    for (const row of existingOccurrences) {
      const instant = Date.parse(row.starts_at);
      const previous = byInstant.get(instant);
      if (previous !== undefined)
        return {
          ok: false,
          problems: [
            `${entry.sourceKey}: found two existing event_occurrences rows at the same start instant (${row.starts_at}, ids ${previous.id} and ${row.id}). This should be impossible once event_occurrences_event_id_starts_at_key (Issue #79) is applied - is ${remote ? 'the remote target' : 'this local target'} on a schema that predates it?`,
          ],
        };
      byInstant.set(instant, row);
    }
    const newOccurrences = [];
    const endsAtFixes = [];
    const doorsAtFixes = [];
    for (const occurrence of entry.occurrences) {
      const match = byInstant.get(occurrence.instant);
      if (match === undefined) {
        newOccurrences.push(occurrence);
        continue;
      }
      if (
        occurrence.endsAt !== null &&
        (match.ends_at === null ? null : Date.parse(match.ends_at)) !==
          Date.parse(occurrence.endsAt)
      )
        endsAtFixes.push({
          id: match.id,
          startsAt: occurrence.startsAt,
          from: match.ends_at,
          endsAt: occurrence.endsAt,
        });
      if (
        occurrence.doorsAt !== null &&
        (match.doors_at === null ? null : Date.parse(match.doors_at)) !==
          Date.parse(occurrence.doorsAt)
      )
        doorsAtFixes.push({
          id: match.id,
          startsAt: occurrence.startsAt,
          from: match.doors_at,
          doorsAt: occurrence.doorsAt,
        });
    }
    const seedInstants = new Set(entry.occurrences.map((occurrence) => occurrence.instant));
    const keptOccurrences = existingOccurrences.filter(
      (row) => !seedInstants.has(Date.parse(row.starts_at)),
    );
    const detailsChanged =
      existing.title !== entry.title ||
      existing.venue !== entry.venue ||
      existing.source_url !== entry.sourceUrl ||
      existing.memo !== entry.memo;
    const rangeChanged = existing.starts_on !== entry.startsOn || existing.ends_on !== entry.endsOn;
    const genrePlan = planGenre(entry, existing.genre_id, genresByKey, genresById);
    if (genrePlan.ok === false) return { ok: false, problems: [genrePlan.problem] };
    const groupResult = await fetchCurrentGroups(admin, existing.id);
    if (!groupResult.ok) return { ok: false, problems: [groupResult.problem] };
    const currentGroups = groupResult.groups;
    plans.push({
      entry,
      expectedCurrent: {
        event: existing,
        occurrences: existingOccurrences,
        groups: currentGroups,
        genreKey: existing.genre_id === null ? null : genresById.get(existing.genre_id)?.key,
      },
      expectedProposedGroups,
      action:
        detailsChanged ||
        rangeChanged ||
        newOccurrences.length > 0 ||
        endsAtFixes.length > 0 ||
        doorsAtFixes.length > 0
          ? 'update'
          : 'unchanged',
      event: existing,
      detailsChanged,
      rangeChanged,
      newOccurrences,
      endsAtFixes,
      doorsAtFixes,
      keptOccurrences: keptOccurrences.length,
      genrePlan,
      groupsPlan: planGroups(entry, currentGroups),
    });
  }
  return { ok: true, plans };
}

const TOKYO_PARTS = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  dateStyle: 'short',
  timeStyle: 'medium',
});
function formatTokyo(value) {
  return value === null
    ? '(unset)'
    : `${TOKYO_PARTS.format(new Date(value)).replace(' ', 'T')}+09:00`;
}
function logFixes(lines, label, fixes, formatValue) {
  if (fixes.length === 0) return;
  lines.push(`          ~ ${fixes.length} occurrence ${label}`);
  for (const fix of fixes.slice(0, 5))
    lines.push(`              ${fix.startsAt}  ${formatValue(fix)}`);
  if (fixes.length > 5) lines.push(`              ... and ${fixes.length - 5} more`);
  const overwrites = fixes.filter((fix) => fix.from !== null).length;
  if (overwrites > 0)
    lines.push(`          ! ${overwrites} of those replace a value already in the catalog`);
}

export function formatEventPlanReport(plans, { apply, remote, ownerEmail, ownerId } = {}) {
  const lines = [
    '',
    `[${apply ? 'APPLY' : 'DRY RUN'}] ${remote ? 'remote' : 'local'} target, owner ${ownerEmail ?? ''} (${ownerId ?? ''})`,
    '',
  ];
  for (const plan of plans) {
    const { entry } = plan;
    const classificationOnlyChange =
      plan.action === 'unchanged' && (plan.genrePlan.changed || plan.groupsPlan.changed);
    lines.push(
      `${(classificationOnlyChange ? 'RECLASSIFY' : plan.action.toUpperCase()).padEnd(9)} ${entry.sourceKey}`,
    );
    lines.push(`          ${entry.title}${entry.venue === null ? '' : ` / ${entry.venue}`}`);
    lines.push(`          Event range ${entry.startsOn} .. ${entry.endsOn}`);
    if (plan.action === 'create')
      lines.push(`          + event, + ${plan.newOccurrences.length} occurrences`);
    else {
      if (plan.detailsChanged) lines.push('          ~ event details');
      if (plan.rangeChanged)
        lines.push(
          `          ~ Event range  ${plan.event.starts_on} .. ${plan.event.ends_on} -> ${entry.startsOn} .. ${entry.endsOn}`,
        );
      if (plan.newOccurrences.length > 0) {
        lines.push(`          + ${plan.newOccurrences.length} occurrences`);
        for (const occurrence of plan.newOccurrences.slice(0, 5))
          lines.push(`              ${occurrence.startsAt}`);
        if (plan.newOccurrences.length > 5)
          lines.push(`              ... and ${plan.newOccurrences.length - 5} more`);
      }
      logFixes(
        lines,
        'end times',
        plan.endsAtFixes,
        (fix) => `${formatTokyo(fix.from)} -> ${formatTokyo(fix.endsAt)}`,
      );
      logFixes(
        lines,
        'doors times',
        plan.doorsAtFixes,
        (fix) => `${formatTokyo(fix.from)} -> ${formatTokyo(fix.doorsAt)}`,
      );
      if (plan.keptOccurrences > 0)
        lines.push(
          `          = ${plan.keptOccurrences} existing occurrences not in this seed, left untouched`,
        );
    }
    if (plan.genrePlan.setGenre && plan.genrePlan.changed)
      lines.push(
        `          ~ genre  ${plan.genrePlan.current === null ? '(none)' : plan.genrePlan.current.display_name} -> ${plan.genrePlan.proposed === null ? '(none)' : plan.genrePlan.proposed.display_name}`,
      );
    if (plan.groupsPlan.setGroups && plan.groupsPlan.changed) {
      if (plan.groupsPlan.added.length > 0)
        lines.push(
          `          + groups  ${plan.groupsPlan.added.map((group) => group.displayName).join(', ')}`,
        );
      if (plan.groupsPlan.removed.length > 0)
        lines.push(
          `          - groups  ${plan.groupsPlan.removed.map((group) => group.displayName).join(', ')}`,
        );
      for (const group of plan.groupsPlan.renamed)
        lines.push(
          `          ~ group displayName  ${group.previousDisplayName} -> ${group.displayName}`,
        );
    }
  }
  const totals = plans.reduce(
    (acc, plan) => ({
      events: acc.events + (plan.action === 'create' ? 1 : 0),
      occurrences: acc.occurrences + plan.newOccurrences.length,
      endsAt: acc.endsAt + plan.endsAtFixes.length,
      doorsAt: acc.doorsAt + plan.doorsAtFixes.length,
      ranges: acc.ranges + (plan.rangeChanged ? 1 : 0),
      genres: acc.genres + (plan.genrePlan.changed ? 1 : 0),
      groups: acc.groups + (plan.groupsPlan.changed ? 1 : 0),
    }),
    { events: 0, occurrences: 0, endsAt: 0, doorsAt: 0, ranges: 0, genres: 0, groups: 0 },
  );
  lines.push(
    '',
    `${plans.length} seed entries: +${totals.events} events, +${totals.occurrences} occurrences, ~${totals.endsAt} end times, ~${totals.doorsAt} doors times, ~${totals.ranges} Event ranges, ~${totals.genres} genres, ~${totals.groups} group associations`,
    '',
  );
  if (!apply) lines.push('Dry run only. Re-run with --apply to write.', '');
  return lines.join('\n');
}

export async function applyEventPlans(
  admin,
  plans,
  { ownerId, onApplied = () => {}, reviewed = false } = {},
) {
  const applied = [];
  const canonicalLabelsAppliedInBatch = new Map();
  for (const plan of plans) {
    const { entry } = plan;
    const classificationChanged = plan.genrePlan.changed || plan.groupsPlan.changed;
    if (reviewed || plan.action !== 'unchanged' || classificationChanged) {
      const fixesById = new Map();
      for (const fix of plan.endsAtFixes)
        fixesById.set(fix.id, { ...fixesById.get(fix.id), id: fix.id, endsAt: fix.endsAt });
      for (const fix of plan.doorsAtFixes)
        fixesById.set(fix.id, { ...fixesById.get(fix.id), id: fix.id, doorsAt: fix.doorsAt });
      const expectedCurrent =
        plan.expectedCurrent === null
          ? null
          : {
              ...plan.expectedCurrent,
              groups: plan.expectedCurrent.groups.map((group) => ({
                ...group,
                displayName: canonicalLabelsAppliedInBatch.get(group.key) ?? group.displayName,
              })),
            };
      const expectedProposedGroups = plan.expectedProposedGroups.map((group) => ({
        ...group,
        displayName: canonicalLabelsAppliedInBatch.get(group.key) ?? group.displayName,
      }));
      const { error } = await admin.rpc(
        reviewed ? 'apply_reviewed_import_event_plan' : 'apply_import_event_plan',
        {
          p_action: plan.action,
          p_owner_id: ownerId,
          p_event_id: plan.action === 'create' ? null : plan.event.id,
          p_source_key: entry.sourceKey,
          p_title: entry.title,
          p_starts_on: entry.startsOn,
          p_ends_on: entry.endsOn,
          p_occurrences: plan.newOccurrences.map((occurrence) => ({
            doorsAt: occurrence.doorsAt,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
          })),
          p_occurrence_fixes: [...fixesById.values()],
          p_venue: entry.venue,
          p_source_url: entry.sourceUrl,
          p_memo: entry.memo,
          p_set_genre: plan.genrePlan.setGenre && plan.genrePlan.changed,
          p_genre_key: plan.genrePlan.genreKey,
          p_set_groups: plan.groupsPlan.setGroups && plan.groupsPlan.changed,
          p_groups: plan.groupsPlan.groups.map((group) => ({
            key: group.key,
            displayName: group.displayName,
          })),
          ...(reviewed
            ? {
                p_expected_current: expectedCurrent,
                p_expected_proposed_groups: expectedProposedGroups,
              }
            : {}),
        },
      );
      if (error)
        return {
          ok: false,
          error: `Failed to apply ${entry.sourceKey}: ${error.message}`,
          stale: error.code === '40001',
          applied,
        };
      applied.push(entry.sourceKey);
      if (reviewed && plan.groupsPlan.setGroups && plan.groupsPlan.changed)
        for (const group of plan.groupsPlan.groups)
          canonicalLabelsAppliedInBatch.set(group.key, group.displayName);
      onApplied(entry.sourceKey);
    }
  }
  return { ok: true, applied };
}
