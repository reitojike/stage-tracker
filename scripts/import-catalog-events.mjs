import fs from 'node:fs';
import path from 'node:path';
import { resolveAdminTarget } from './lib/adminTarget.mjs';
import { findUserByEmail } from './lib/findUserByEmail.mjs';
import {
  findConflictingGroupDefinitions,
  validateClassificationShape,
} from './lib/eventClassificationSeed.mjs';

// Operator-assisted catalog import (Issue #73).
//
// Gate A needs real 公演 data in the shared catalog to test whether
// stage-tracker works as a shared planning surface. Entering it through
// the UI is not viable: the first import alone is ~430 公演回 across 10
// productions, and OccurrenceAddForm adds one at a time.
//
// WHAT THIS SCRIPT IS NOT: it does not fetch anything. It reads a local
// JSON file that an operator has reviewed, and applies it. Reading the
// official schedule pages and turning them into that file is done by an
// agent on request ("import this URL"), outside this repository, because
// every source lays its schedule out differently - 宝塚's pages use a
// two-slot-per-day table, 歌舞伎座 states 部 times and 休演 dates in
// prose, 平成中村座 publishes a per-date grid. Encoding those layouts as
// per-site parsers here is the general crawler this Task explicitly
// excludes, and it would break silently whenever a page changed.
//
// The seed files themselves are deliberately NOT in this repository (see
// .gitignore and docs/runbooks/catalog-import.md): this repository is
// public, the data is a transcription of someone else's published
// schedule, and it is closer to transaction data than to product code.
//
// Local:  node scripts/import-catalog-events.mjs <path> --owner <email>
// Remote: node scripts/import-catalog-events.mjs <path> --owner <email> --remote
//   (requires STAGE_TRACKER_REMOTE_SUPABASE_URL /
//   STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY - see scripts/lib/adminTarget.mjs)
//
// Dry run is the default. Nothing is written without --apply.

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const apply = args.includes('--apply');
const ownerIndex = args.indexOf('--owner');
const ownerEmail = ownerIndex === -1 ? undefined : args[ownerIndex + 1];
const positional = args.filter((arg, index) => !arg.startsWith('--') && index !== ownerIndex + 1);
const target = positional[0];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  process.exit();
}

if (typeof target !== 'string' || typeof ownerEmail !== 'string' || ownerEmail.length === 0) {
  fail(
    'Usage: node scripts/import-catalog-events.mjs <file-or-directory> --owner <email> [--apply] [--remote]',
  );
}

// ---------------------------------------------------------------- loading

function seedFilePaths(entry) {
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(entry)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => path.join(entry, name));
  }
  return [entry];
}

const HAS_UTC_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
const HAS_CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

// Asia/Tokyo has a fixed +09:00 offset (no DST), so shifting an instant by
// that constant and reading its UTC calendar fields back out gives the
// Tokyo calendar date without a timezone database - the same technique
// domain/eventCatalog.ts's tokyoCalendarDateFromInstant uses, duplicated
// here rather than imported since this script is a standalone .mjs with no
// import of src/domain/* (see the module header comment).
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
function tokyoDateOf(instantIso) {
  const tokyo = new Date(Date.parse(instantIso) + TOKYO_OFFSET_MS);
  const year = String(tokyo.getUTCFullYear()).padStart(4, '0');
  const month = String(tokyo.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tokyo.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Every field is checked before anything is written, and a single bad
// entry aborts the whole run. Partial application is recoverable (this
// script is idempotent, so re-running finishes the job), but a partially
// *validated* run would mean the operator reviewed one thing and the
// catalog received another.
function validateEntry(entry, where) {
  const problems = [];
  const text = (value, field, required) => {
    if (value === null || value === undefined) {
      if (required) problems.push(`${field} is required`);
      return null;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      problems.push(`${field} must be a non-empty string when present`);
      return null;
    }
    return value.trim();
  };

  const sourceKey = text(entry.sourceKey, 'sourceKey', true);
  const title = text(entry.title, 'title', true);
  const venue = text(entry.venue, 'venue', false);
  const memo = text(entry.memo, 'memo', false);
  const sourceUrl = text(entry.sourceUrl, 'sourceUrl', false);
  if (sourceUrl !== null && !/^https?:\/\//.test(sourceUrl)) {
    problems.push('sourceUrl must start with http:// or https://');
  }

  // Event range (Issue #87/#88): the officially published 初日〜千秋楽, a
  // product fact independent of whatever occurrences are known - never
  // derived from occurrences.min/max here, mirroring the DB backfill
  // migration's own caveat that a mechanical min/max is only an initial
  // value, not necessarily the official range.
  const startsOn = text(entry.startsOn, 'startsOn', true);
  if (startsOn !== null && !HAS_CALENDAR_DATE_SHAPE.test(startsOn)) {
    problems.push('startsOn must be an Asia/Tokyo calendar date as "YYYY-MM-DD"');
  }
  const endsOn = text(entry.endsOn, 'endsOn', true);
  if (endsOn !== null && !HAS_CALENDAR_DATE_SHAPE.test(endsOn)) {
    problems.push('endsOn must be an Asia/Tokyo calendar date as "YYYY-MM-DD"');
  }
  if (
    startsOn !== null &&
    endsOn !== null &&
    HAS_CALENDAR_DATE_SHAPE.test(startsOn) &&
    HAS_CALENDAR_DATE_SHAPE.test(endsOn) &&
    startsOn > endsOn
  ) {
    problems.push('endsOn must not be earlier than startsOn');
  }

  // Issue #87/#88: occurrences may be empty (开催期間 known, no 公演回 yet
  // published) - the non-empty requirement this used to hold (mirroring
  // the pre-#88 create_event_with_occurrence contract) is gone.
  const rawOccurrences = Array.isArray(entry.occurrences) ? entry.occurrences : null;
  if (rawOccurrences === null) {
    problems.push('occurrences must be an array (possibly empty)');
  }

  const occurrences = [];
  const seenInstants = new Set();
  for (const [index, raw] of (rawOccurrences ?? []).entries()) {
    const at = `occurrences[${index}]`;
    const startsAt = typeof raw?.startsAt === 'string' ? Date.parse(raw.startsAt) : Number.NaN;
    if (Number.isNaN(startsAt)) {
      problems.push(`${at}.startsAt must be a parseable timestamp`);
      continue;
    }
    // The seed file is written by hand/by an agent, for a product whose
    // day boundary is Asia/Tokyo. A bare "2026-07-11T13:00:00" would be
    // read as UTC here and land nine hours off, silently, so the offset is
    // required rather than defaulted.
    if (!HAS_UTC_OFFSET.test(raw.startsAt)) {
      problems.push(`${at}.startsAt must carry an explicit UTC offset (e.g. +09:00)`);
      continue;
    }
    if (seenInstants.has(startsAt)) {
      // Occurrence identity is (event_id, starts_at) - see the migration
      // that adds events.source_key. Two seed rows at the same instant
      // would make this run non-idempotent against itself.
      problems.push(`${at}.startsAt duplicates another occurrence in the same event`);
      continue;
    }
    seenInstants.add(startsAt);

    // Containment (Issue #88): every occurrence's Tokyo calendar date must
    // fall within the event's own [startsOn, endsOn] - the same invariant
    // the DB enforces at commit, checked here so a mistaken seed is caught
    // during review, not as an opaque database error during --apply.
    if (startsOn !== null && endsOn !== null) {
      const occurrenceDate = tokyoDateOf(raw.startsAt);
      if (occurrenceDate < startsOn || occurrenceDate > endsOn) {
        problems.push(
          `${at}.startsAt (Asia/Tokyo date ${occurrenceDate}) is outside the event's range [${startsOn}, ${endsOn}]`,
        );
        continue;
      }
    }

    let endsAt = null;
    if (raw.endsAt !== null && raw.endsAt !== undefined) {
      const parsed = typeof raw.endsAt === 'string' ? Date.parse(raw.endsAt) : Number.NaN;
      if (Number.isNaN(parsed) || !HAS_UTC_OFFSET.test(raw.endsAt)) {
        problems.push(`${at}.endsAt must be a parseable timestamp with an explicit UTC offset`);
        continue;
      }
      if (parsed < startsAt) {
        problems.push(`${at}.endsAt is earlier than startsAt`);
        continue;
      }
      endsAt = raw.endsAt;
    }

    let doorsAt = null;
    if (raw.doorsAt !== null && raw.doorsAt !== undefined) {
      const parsed = typeof raw.doorsAt === 'string' ? Date.parse(raw.doorsAt) : Number.NaN;
      if (Number.isNaN(parsed) || !HAS_UTC_OFFSET.test(raw.doorsAt)) {
        problems.push(`${at}.doorsAt must be a parseable timestamp with an explicit UTC offset`);
        continue;
      }
      if (parsed > startsAt) {
        problems.push(`${at}.doorsAt is later than startsAt`);
        continue;
      }
      doorsAt = raw.doorsAt;
    }

    occurrences.push({ doorsAt, startsAt: raw.startsAt, endsAt, instant: startsAt });
  }

  // Optional genre/group classification (Issue #167, PO decision #158).
  // Absent `genre`/`groups` fields are valid and mean "leave this Event's
  // existing classification untouched" - an old seed written before this
  // Task exists is not a breaking case (Issue #167 "既存seedを突然壊す
  // 必要がなければoptional extensionを優先"). See
  // scripts/lib/eventClassificationSeed.mjs for the full field contract.
  const classificationResult = validateClassificationShape(entry);
  let classification = { genre: undefined, groups: undefined };
  if (!classificationResult.ok) {
    problems.push(...classificationResult.problems);
  } else {
    classification = classificationResult.classification;
  }

  if (problems.length > 0) {
    fail(`${where}: invalid seed entry\n  - ${problems.join('\n  - ')}`);
  }
  return {
    sourceKey,
    title,
    venue,
    memo,
    sourceUrl,
    startsOn,
    endsOn,
    occurrences,
    classification,
  };
}

const entries = [];
for (const file of seedFilePaths(target)) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file}: not valid JSON (${error.message})`);
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  list.forEach((entry, index) => {
    entries.push(validateEntry(entry, `${file}[${index}]`));
  });
}

const duplicateKeys = entries
  .map((entry) => entry.sourceKey)
  .filter((key, index, all) => all.indexOf(key) !== index);
if (duplicateKeys.length > 0) {
  fail(`Duplicate sourceKey across seed files: ${[...new Set(duplicateKeys)].join(', ')}`);
}

// "duplicate canonical group identity conflict" (Issue #167 required
// import validation) - a run-wide check, since two different seed
// entries giving the same group key inconsistent displayName values is a
// conflict across entries, not something any single entry's own shape
// validation could catch.
const groupConflicts = findConflictingGroupDefinitions(entries);
if (groupConflicts.length > 0) {
  fail(`Conflicting group definitions in this import run:\n  - ${groupConflicts.join('\n  - ')}`);
}

// ----------------------------------------------------------------- target

const admin = resolveAdminTarget(remote);

const owner = await findUserByEmail(admin, ownerEmail);
if (owner === null) {
  fail(
    `No account found for ${ownerEmail}. Provision it first: node scripts/provision-user.mjs ${ownerEmail}${remote ? ' --remote' : ''}`,
  );
}

// This script writes as service_role, which bypasses RLS and the
// designated-creator check inside create_event_with_occurrence. That makes
// it a potential way to create catalog entries owned by someone who is not
// allowed to create them at all, which would quietly contradict the MVP
// Event catalog write boundary. Checking membership here is what keeps an
// imported event indistinguishable, in permission terms, from one created
// through the UI.
const { data: creatorRow, error: creatorError } = await admin
  .from('catalog_creators')
  .select('user_id')
  .eq('user_id', owner.id)
  .maybeSingle();
if (creatorError) {
  fail(`Failed to check catalog creator membership: ${creatorError.message}`);
}
if (creatorRow === null) {
  fail(
    `${ownerEmail} is not a designated catalog creator. Grant it first: npm run catalog:grant-creator ${ownerEmail}${remote ? ' -- --remote' : ''}`,
  );
}

// ------------------------------------------------------------------- plan

// Genres are a small, catalog-wide lookup table (Gate A ships 3 rows) -
// fetched once up front rather than per entry. Resolving an unknown genre
// key here, during planning, gives the operator a clear dry-run failure
// instead of only discovering it from import_event_classification's own
// "unknown genre key" error at --apply time.
const { data: genreRows, error: genresError } = await admin
  .from('genres')
  .select('id, key, display_name');
if (genresError) {
  fail(`Failed to read genres: ${genresError.message}`);
}
const genresByKey = new Map(genreRows.map((row) => [row.key, row]));
const genresById = new Map(genreRows.map((row) => [row.id, row]));

// Classification diffing (Issue #167 "dry-runでclassification changesを
// 確認できる"): entry.classification.genre/groups being `undefined` means
// the seed did not mention that facet at all, so the plan must not touch
// it - matching import_event_classification's own p_set_genre/
// p_set_groups "touch or not" split.
function planGenre(entry, currentGenreId) {
  if (entry.classification.genre === undefined) {
    const current = currentGenreId === null ? null : (genresById.get(currentGenreId) ?? null);
    return { setGenre: false, genreKey: null, changed: false, current, proposed: current };
  }
  const genreKey = entry.classification.genre;
  if (genreKey !== null && !genresByKey.has(genreKey)) {
    fail(
      `${entry.sourceKey}: unknown genre key "${genreKey}" (known genres: ${[...genresByKey.keys()].join(', ')})`,
    );
  }
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
  if (entry.classification.groups === undefined) {
    return {
      setGroups: false,
      groups: [],
      changed: false,
      current: currentGroups,
      added: [],
      removed: [],
      renamed: [],
    };
  }
  const proposed = entry.classification.groups;
  const currentByKey = new Map(currentGroups.map((group) => [group.key, group]));
  const proposedKeys = new Set(proposed.map((group) => group.key));
  const added = proposed.filter((group) => !currentByKey.has(group.key));
  const removed = currentGroups.filter((group) => !proposedKeys.has(group.key));
  // Carries previousDisplayName up front (computed here, where
  // currentByKey is already in scope) so the report loop below can print
  // the rename without a second lookup back into `current` by key.
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

async function fetchCurrentGroups(eventId) {
  const { data, error } = await admin
    .from('event_groups')
    .select('groups(key, display_name)')
    .eq('event_id', eventId);
  if (error) {
    fail(`Failed to read group associations for event ${eventId}: ${error.message}`);
  }
  return data
    .filter((row) => row.groups !== null)
    .map((row) => ({ key: row.groups.key, displayName: row.groups.display_name }));
}

const plans = [];
for (const entry of entries) {
  const { data: existing, error } = await admin
    .from('events')
    .select('id, title, venue, source_url, memo, owner_id, starts_on, ends_on, genre_id')
    .eq('source_key', entry.sourceKey)
    .maybeSingle();
  if (error) {
    fail(`Failed to look up ${entry.sourceKey}: ${error.message}`);
  }

  if (existing === null) {
    plans.push({
      entry,
      action: 'create',
      event: null,
      detailsChanged: false,
      rangeChanged: false,
      newOccurrences: entry.occurrences,
      endsAtFixes: [],
      doorsAtFixes: [],
      keptOccurrences: 0,
      genrePlan: planGenre(entry, null),
      groupsPlan: planGroups(entry, []),
    });
    continue;
  }

  // Ownership is never rewritten. If a seed file is applied against an
  // event someone else owns, that is a mistake to surface, not to silently
  // correct - and owner transfer is not a product operation
  // (product-rules.md), so this script must not become one.
  if (existing.owner_id !== owner.id) {
    fail(
      `${entry.sourceKey} already exists and is owned by ${existing.owner_id}, not ${ownerEmail} (${owner.id}). Refusing to touch it.`,
    );
  }

  const { data: existingOccurrences, error: occurrenceError } = await admin
    .from('event_occurrences')
    .select('id, doors_at, starts_at, ends_at')
    .eq('event_id', existing.id);
  if (occurrenceError) {
    fail(`Failed to read occurrences for ${entry.sourceKey}: ${occurrenceError.message}`);
  }

  // (event_id, starts_at) is how this script identifies an occurrence, and
  // event_occurrences_event_id_starts_at_key (Issue #79) now makes that pair
  // a DB-level UNIQUE constraint - two existing rows sharing an instant
  // should be structurally impossible on a database this migration has
  // been applied to. Failing loudly here, instead of guessing which row a
  // seed instant means (the previous behaviour: collect colliding instants,
  // skip them, and warn), turns "this target predates the migration" into
  // an immediate, specific error rather than a silently-skipped end-time
  // update.
  const byInstant = new Map();
  for (const row of existingOccurrences) {
    const instant = Date.parse(row.starts_at);
    const previous = byInstant.get(instant);
    if (previous !== undefined) {
      fail(
        `${entry.sourceKey}: found two existing event_occurrences rows at the same start instant (${row.starts_at}, ids ${previous.id} and ${row.id}). This should be impossible once event_occurrences_event_id_starts_at_key (Issue #79) is applied - is ${remote ? 'the remote target' : 'this local target'} on a schema that predates it?`,
      );
    }
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
    // Sources publish 上演時間 (and 開場時刻) only shortly before 初日, so a
    // first import usually lands with no end/doors time and a later
    // re-import can fill it in. Filling a blank is the point; clearing a
    // value that is already there is not - a seed file that has since lost
    // a value must not erase what the catalog already knows.
    if (occurrence.endsAt !== null) {
      const current = match.ends_at === null ? null : Date.parse(match.ends_at);
      if (current !== Date.parse(occurrence.endsAt)) {
        endsAtFixes.push({
          id: match.id,
          startsAt: occurrence.startsAt,
          // Carried so the dry run can show what is being replaced, not
          // just how many rows change. A non-null `from` means the seed is
          // overwriting a value the catalog already had - which includes
          // one an owner may have corrected by hand through the UI, since
          // an imported occurrence is editable exactly like a manual one.
          // The seed stays authoritative for occurrences it names, so the
          // protection here is visibility, not refusal.
          from: match.ends_at,
          endsAt: occurrence.endsAt,
        });
      }
    }
    if (occurrence.doorsAt !== null) {
      const current = match.doors_at === null ? null : Date.parse(match.doors_at);
      if (current !== Date.parse(occurrence.doorsAt)) {
        doorsAtFixes.push({
          id: match.id,
          startsAt: occurrence.startsAt,
          from: match.doors_at,
          doorsAt: occurrence.doorsAt,
        });
      }
    }
  }

  // Occurrences in the catalog that this seed file does not mention are
  // left completely alone, and are not even counted as a discrepancy to
  // resolve. That is the case the operator relies on: 貸切公演 are not
  // imported (their start time is usually unpublished), so if they get a
  // ticket for one they add that 公演回 by hand - and a later re-import of
  // the same production must not disturb it. Nothing here deletes.
  const seedInstants = new Set(entry.occurrences.map((occurrence) => occurrence.instant));
  const kept = existingOccurrences.filter((row) => !seedInstants.has(Date.parse(row.starts_at)));

  const detailsChanged =
    existing.title !== entry.title ||
    existing.venue !== entry.venue ||
    existing.source_url !== entry.sourceUrl ||
    existing.memo !== entry.memo;

  // Event range (Issue #87/#88): the seed's startsOn/endsOn is authoritative
  // for events it names, same as its occurrence end/doors times - a
  // mechanical backfill value differing from the seed's official range is
  // exactly the discrepancy this comparison exists to surface and correct.
  const rangeChanged = existing.starts_on !== entry.startsOn || existing.ends_on !== entry.endsOn;

  const genrePlan = planGenre(entry, existing.genre_id);
  const groupsPlan = planGroups(
    entry,
    entry.classification.groups === undefined ? [] : await fetchCurrentGroups(existing.id),
  );

  plans.push({
    entry,
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
    keptOccurrences: kept.length,
    genrePlan,
    groupsPlan,
  });
}

// ------------------------------------------------------------------ report

// Postgres hands timestamptz back in UTC while seed values are written with
// the +09:00 offset the product's day boundary uses. Printing an existing
// value next to its replacement in two different zones is exactly the
// comparison an operator has to make by eye before allowing an overwrite,
// so both sides are rendered in Asia/Tokyo. Japan has no DST, so the fixed
// offset below is not an approximation.
const TOKYO_PARTS = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  dateStyle: 'short',
  timeStyle: 'medium',
});

function formatTokyo(value) {
  if (value === null) {
    return '(unset)';
  }
  return `${TOKYO_PARTS.format(new Date(value)).replace(' ', 'T')}+09:00`;
}

const label = apply ? 'APPLY' : 'DRY RUN';
console.log(
  `\n[${label}] ${remote ? 'remote' : 'local'} target, owner ${ownerEmail} (${owner.id})\n`,
);
function logFixes(label, fixes, formatValue) {
  if (fixes.length === 0) return;
  console.log(`          ~ ${fixes.length} occurrence ${label}`);
  for (const fix of fixes.slice(0, 5)) {
    console.log(`              ${fix.startsAt}  ${formatValue(fix)}`);
  }
  if (fixes.length > 5) {
    console.log(`              ... and ${fixes.length - 5} more`);
  }
  const overwrites = fixes.filter((fix) => fix.from !== null).length;
  if (overwrites > 0) {
    console.log(`          ! ${overwrites} of those replace a value already in the catalog`);
  }
}

for (const plan of plans) {
  const { entry } = plan;
  console.log(`${plan.action.toUpperCase().padEnd(9)} ${entry.sourceKey}`);
  console.log(`          ${entry.title}${entry.venue === null ? '' : ` / ${entry.venue}`}`);
  console.log(`          Event range ${entry.startsOn} .. ${entry.endsOn}`);
  if (plan.action === 'create') {
    console.log(`          + event, + ${plan.newOccurrences.length} occurrences`);
  } else {
    if (plan.detailsChanged) console.log('          ~ event details');
    if (plan.rangeChanged) {
      console.log(
        `          ~ Event range  ${plan.event.starts_on} .. ${plan.event.ends_on} -> ${entry.startsOn} .. ${entry.endsOn}`,
      );
    }
    if (plan.newOccurrences.length > 0) {
      console.log(`          + ${plan.newOccurrences.length} occurrences`);
      for (const occurrence of plan.newOccurrences.slice(0, 5)) {
        console.log(`              ${occurrence.startsAt}`);
      }
      if (plan.newOccurrences.length > 5) {
        console.log(`              ... and ${plan.newOccurrences.length - 5} more`);
      }
    }
    logFixes(
      'end times',
      plan.endsAtFixes,
      (fix) => `${formatTokyo(fix.from)} -> ${formatTokyo(fix.endsAt)}`,
    );
    logFixes(
      'doors times',
      plan.doorsAtFixes,
      (fix) => `${formatTokyo(fix.from)} -> ${formatTokyo(fix.doorsAt)}`,
    );
    if (plan.keptOccurrences > 0) {
      console.log(
        `          = ${plan.keptOccurrences} existing occurrences not in this seed, left untouched`,
      );
    }
  }

  // Classification (Issue #167) is reported independently of `action`
  // above: a seed can correct genre/groups on an otherwise-unchanged
  // Event, and the operator needs to see that even when nothing else in
  // this plan would otherwise print a line.
  if (plan.genrePlan.setGenre && plan.genrePlan.changed) {
    const currentLabel =
      plan.genrePlan.current === null ? '(none)' : plan.genrePlan.current.display_name;
    const proposedLabel =
      plan.genrePlan.proposed === null ? '(none)' : plan.genrePlan.proposed.display_name;
    console.log(`          ~ genre  ${currentLabel} -> ${proposedLabel}`);
  }
  if (plan.groupsPlan.setGroups && plan.groupsPlan.changed) {
    if (plan.groupsPlan.added.length > 0) {
      console.log(
        `          + groups  ${plan.groupsPlan.added.map((group) => group.displayName).join(', ')}`,
      );
    }
    if (plan.groupsPlan.removed.length > 0) {
      console.log(
        `          - groups  ${plan.groupsPlan.removed.map((group) => group.displayName).join(', ')}`,
      );
    }
    if (plan.groupsPlan.renamed.length > 0) {
      for (const group of plan.groupsPlan.renamed) {
        console.log(
          `          ~ group displayName  ${group.previousDisplayName} -> ${group.displayName}`,
        );
      }
    }
  }
}

const totals = plans.reduce(
  (acc, plan) => ({
    events: acc.events + (plan.action === 'create' ? 1 : 0),
    occurrences: acc.occurrences + plan.newOccurrences.length,
    endsAt: acc.endsAt + plan.endsAtFixes.length,
    doorsAt: acc.doorsAt + plan.doorsAtFixes.length,
    ranges: acc.ranges + (plan.rangeChanged ? 1 : 0),
    // A seed can correct genre/groups on an otherwise fully-unchanged
    // Event (see the per-plan classification report block above) - this
    // summary line must count that too, or a reclassification-only run
    // would print "+0 events, +0 occurrences, ..." and read as a no-op
    // even though real classification writes are about to happen.
    genres: acc.genres + (plan.genrePlan.changed ? 1 : 0),
    groups: acc.groups + (plan.groupsPlan.changed ? 1 : 0),
  }),
  { events: 0, occurrences: 0, endsAt: 0, doorsAt: 0, ranges: 0, genres: 0, groups: 0 },
);
console.log(
  `\n${plans.length} seed entries: +${totals.events} events, +${totals.occurrences} occurrences, ` +
    `~${totals.endsAt} end times, ~${totals.doorsAt} doors times, ~${totals.ranges} Event ranges, ` +
    `~${totals.genres} genres, ~${totals.groups} group associations\n`,
);

if (!apply) {
  console.log('Dry run only. Re-run with --apply to write.\n');
  process.exit();
}

// ------------------------------------------------------------------ apply

// No transaction spans the whole run, and it does not need to: partial
// application is safe because the script is idempotent - re-running after a
// failure resumes rather than duplicates, which is what source_key and
// (event_id, starts_at) matching exist for.
//
// Both a create and an update need real atomicity, and both get it from the
// database rather than from this loop, via a single RPC call each -
// import_event_with_occurrences for create, import_update_event for update
// (Issue #88). A half-finished create used to risk a zero-occurrence event
// (no longer a product invariant violation on its own, but the create RPC
// stays atomic regardless); a half-finished update that moves the Event
// range and some occurrence times separately risks tripping the
// cross-table containment invariant mid-sequence, which import_update_event
// avoids by deferring it to the end of its own transaction (see that
// function's migration comment). Client-side compensation was tried first
// for the create case and is insufficient: it cannot run at all if the
// response is lost after the event INSERT commits, or if the process dies
// between two requests.
for (const plan of plans) {
  const { entry } = plan;
  let createdEvent = null;

  if (plan.action === 'create') {
    const { data, error } = await admin.rpc('import_event_with_occurrences', {
      p_owner_id: owner.id,
      p_source_key: entry.sourceKey,
      p_title: entry.title,
      p_starts_on: entry.startsOn,
      p_ends_on: entry.endsOn,
      p_occurrences: plan.newOccurrences.map((occurrence) => ({
        doorsAt: occurrence.doorsAt,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
      })),
      p_venue: entry.venue,
      p_source_url: entry.sourceUrl,
      p_memo: entry.memo,
    });
    if (error) {
      fail(`Failed to create ${entry.sourceKey}: ${error.message}`);
    }
    createdEvent = data;
  } else if (plan.action === 'update') {
    const fixesById = new Map();
    for (const fix of plan.endsAtFixes) {
      fixesById.set(fix.id, { ...fixesById.get(fix.id), id: fix.id, endsAt: fix.endsAt });
    }
    for (const fix of plan.doorsAtFixes) {
      fixesById.set(fix.id, { ...fixesById.get(fix.id), id: fix.id, doorsAt: fix.doorsAt });
    }
    const { error } = await admin.rpc('import_update_event', {
      p_event_id: plan.event.id,
      p_title: entry.title,
      p_venue: entry.venue,
      p_source_url: entry.sourceUrl,
      p_memo: entry.memo,
      p_starts_on: entry.startsOn,
      p_ends_on: entry.endsOn,
      p_new_occurrences: plan.newOccurrences.map((occurrence) => ({
        doorsAt: occurrence.doorsAt,
        startsAt: occurrence.startsAt,
        endsAt: occurrence.endsAt,
      })),
      p_occurrence_fixes: [...fixesById.values()],
    });
    if (error) {
      fail(`Failed to update ${entry.sourceKey}: ${error.message}`);
    }
  }

  // Classification (Issue #167) is written through a separate, dedicated
  // RPC call from the event-fields/occurrences one above - genre/group
  // correction is a fully independent concern from title/venue/occurrence
  // changes (an Event whose occurrences are unchanged can still need a
  // genre correction, and vice versa), the same separation
  // import_ticket_opportunity draws from events' own create/update RPCs.
  // Only called when there is actually something to write, and only for
  // the facet(s) that actually changed: `changed` already accounts for
  // "seed touched this facet but the value matches what is already
  // there", so a plan with no real classification change makes no RPC
  // call at all, and - independently - a plan where only one facet
  // changed passes p_set_genre/p_set_groups = true for that facet alone.
  // Without this, a seed entry that reconfirms an already-correct groups
  // list alongside an unrelated genre correction would still make the RPC
  // delete-and-reinsert every event_groups row and re-upsert every group
  // for no actual change, churning groups.updated_at/event_groups.created_at
  // on rows nothing about which had changed.
  const eventId = plan.action === 'create' ? createdEvent.id : plan.event.id;
  const classificationChanged = plan.genrePlan.changed || plan.groupsPlan.changed;
  if (classificationChanged) {
    const { error: classificationError } = await admin.rpc('import_event_classification', {
      p_event_id: eventId,
      p_set_genre: plan.genrePlan.setGenre && plan.genrePlan.changed,
      p_genre_key: plan.genrePlan.genreKey,
      p_set_groups: plan.groupsPlan.setGroups && plan.groupsPlan.changed,
      p_groups: plan.groupsPlan.groups.map((group) => ({
        key: group.key,
        displayName: group.displayName,
      })),
    });
    if (classificationError) {
      fail(
        `Failed to update classification for ${entry.sourceKey}: ${classificationError.message}`,
      );
    }
  }

  if (plan.action !== 'unchanged' || classificationChanged) {
    console.log(`applied ${entry.sourceKey}`);
  }
}

console.log('\nDone.\n');
