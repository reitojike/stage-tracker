import fs from 'node:fs';
import path from 'node:path';
import { resolveAdminTarget } from './lib/adminTarget.mjs';
import { findUserByEmail } from './lib/findUserByEmail.mjs';

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

  // An event must have at least one 公演回 (product-rules.md). The RPC the
  // UI uses enforces that by creating both in one transaction; this script
  // writes as service_role and bypasses RLS, so it has to hold the same
  // line itself rather than inherit it.
  const rawOccurrences = Array.isArray(entry.occurrences) ? entry.occurrences : null;
  if (rawOccurrences === null || rawOccurrences.length === 0) {
    problems.push('occurrences must be a non-empty array');
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

    let endsAt = null;
    if (raw.endsAt !== null && raw.endsAt !== undefined) {
      const parsed = typeof raw.endsAt === 'string' ? Date.parse(raw.endsAt) : Number.NaN;
      if (Number.isNaN(parsed) || !HAS_UTC_OFFSET.test(raw.endsAt)) {
        problems.push(`${at}.endsAt must be a parseable timestamp with an explicit UTC offset`);
        continue;
      }
      if (parsed < startsAt) {
        // event_occurrences has no CHECK for this yet (Issue #46), so the
        // write paths are what enforce it; this is the same rule the UI
        // applies, held here too rather than assumed.
        problems.push(`${at}.endsAt is earlier than startsAt`);
        continue;
      }
      endsAt = raw.endsAt;
    }
    occurrences.push({ startsAt: raw.startsAt, endsAt, instant: startsAt });
  }

  if (problems.length > 0) {
    fail(`${where}: invalid seed entry\n  - ${problems.join('\n  - ')}`);
  }
  return { sourceKey, title, venue, memo, sourceUrl, occurrences };
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

const plans = [];
for (const entry of entries) {
  const { data: existing, error } = await admin
    .from('events')
    .select('id, title, venue, source_url, memo, owner_id')
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
      newOccurrences: entry.occurrences,
      endsAtFixes: [],
      keptOccurrences: 0,
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
    .select('id, starts_at, ends_at')
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
  for (const occurrence of entry.occurrences) {
    const match = byInstant.get(occurrence.instant);
    if (match === undefined) {
      newOccurrences.push(occurrence);
      continue;
    }
    // Sources publish 上演時間 only shortly before 初日, so a first import
    // usually lands with no end time and a later re-import can fill it in.
    // Filling a blank is the point; clearing a value that is already there
    // is not - a seed file that has since lost its end time must not erase
    // what the catalog already knows.
    if (occurrence.endsAt === null) {
      continue;
    }
    const current = match.ends_at === null ? null : Date.parse(match.ends_at);
    if (current !== Date.parse(occurrence.endsAt)) {
      endsAtFixes.push({
        id: match.id,
        startsAt: occurrence.startsAt,
        // Carried so the dry run can show what is being replaced, not just
        // how many rows change. A non-null `from` means the seed is
        // overwriting an end time the catalog already had - which includes
        // one an owner may have corrected by hand through the UI, since an
        // imported occurrence is editable exactly like a manual one. The
        // seed stays authoritative for occurrences it names, so the
        // protection here is visibility, not refusal.
        from: match.ends_at,
        endsAt: occurrence.endsAt,
      });
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

  plans.push({
    entry,
    action:
      detailsChanged || newOccurrences.length > 0 || endsAtFixes.length > 0
        ? 'update'
        : 'unchanged',
    event: existing,
    detailsChanged,
    newOccurrences,
    endsAtFixes,
    keptOccurrences: kept.length,
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
for (const plan of plans) {
  const { entry } = plan;
  console.log(`${plan.action.toUpperCase().padEnd(9)} ${entry.sourceKey}`);
  console.log(`          ${entry.title}${entry.venue === null ? '' : ` / ${entry.venue}`}`);
  if (plan.action === 'create') {
    const first = plan.newOccurrences[0];
    const last = plan.newOccurrences[plan.newOccurrences.length - 1];
    console.log(`          + event, + ${plan.newOccurrences.length} occurrences`);
    console.log(`          range ${first.startsAt} .. ${last.startsAt}`);
  } else {
    if (plan.detailsChanged) console.log('          ~ event details');
    if (plan.newOccurrences.length > 0) {
      console.log(`          + ${plan.newOccurrences.length} occurrences`);
      for (const occurrence of plan.newOccurrences.slice(0, 5)) {
        console.log(`              ${occurrence.startsAt}`);
      }
      if (plan.newOccurrences.length > 5) {
        console.log(`              ... and ${plan.newOccurrences.length - 5} more`);
      }
    }
    if (plan.endsAtFixes.length > 0) {
      console.log(`          ~ ${plan.endsAtFixes.length} occurrence end times`);
      for (const fix of plan.endsAtFixes.slice(0, 5)) {
        console.log(
          `              ${fix.startsAt}  ${formatTokyo(fix.from)} -> ${formatTokyo(fix.endsAt)}`,
        );
      }
      if (plan.endsAtFixes.length > 5) {
        console.log(`              ... and ${plan.endsAtFixes.length - 5} more`);
      }
      const overwrites = plan.endsAtFixes.filter((fix) => fix.from !== null).length;
      if (overwrites > 0) {
        console.log(
          `          ! ${overwrites} of those replace an end time already in the catalog`,
        );
      }
    }
    if (plan.keptOccurrences > 0) {
      console.log(
        `          = ${plan.keptOccurrences} existing occurrences not in this seed, left untouched`,
      );
    }
  }
}

const totals = plans.reduce(
  (acc, plan) => ({
    events: acc.events + (plan.action === 'create' ? 1 : 0),
    occurrences: acc.occurrences + plan.newOccurrences.length,
    endsAt: acc.endsAt + plan.endsAtFixes.length,
  }),
  { events: 0, occurrences: 0, endsAt: 0 },
);
console.log(
  `\n${plans.length} seed entries: +${totals.events} events, +${totals.occurrences} occurrences, ~${totals.endsAt} end times\n`,
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
// One step does need real atomicity, and gets it from the database rather
// than from this loop: creating an event together with its occurrences.
// Every other write here leaves a state that is either already correct or
// repaired by the next run, but a half-finished *create* would leave an
// event with no occurrences at all - a product invariant violation visible
// in the shared catalog. That step goes through
// import_event_with_occurrences (one call, one transaction) instead of
// being sequenced here. Client-side compensation was tried first and is
// insufficient: it cannot run at all if the response is lost after the
// event INSERT commits, or if the process dies between two requests.
for (const plan of plans) {
  const { entry } = plan;
  let eventId = plan.event?.id ?? null;

  if (plan.action === 'create') {
    // One call, one transaction: the event row and every occurrence are
    // written together or not at all (see
    // 20260823040000_create_import_event_with_occurrences_rpc.sql). Writing
    // them as two requests and compensating on error was not enough - a lost
    // response after the event INSERT commits, or the process being killed
    // between the two requests, would leave a zero-occurrence event in the
    // shared catalog with nothing left running to undo it. Nothing in this
    // script deletes any more.
    const { data, error } = await admin.rpc('import_event_with_occurrences', {
      p_owner_id: owner.id,
      p_source_key: entry.sourceKey,
      p_title: entry.title,
      p_occurrences: plan.newOccurrences.map((occurrence) => ({
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
    eventId = data.id;
  } else if (plan.detailsChanged) {
    const { error } = await admin
      .from('events')
      .update({
        title: entry.title,
        venue: entry.venue,
        source_url: entry.sourceUrl,
        memo: entry.memo,
      })
      .eq('id', eventId);
    if (error) {
      fail(`Failed to update ${entry.sourceKey}: ${error.message}`);
    }
  }

  // Only for events that already existed: a create plan's occurrences went
  // in with the event itself, inside the RPC above. Adding occurrences to an
  // event that already has some cannot produce a zero-occurrence event, so
  // this path needs no atomicity beyond the per-statement kind - a failure
  // here leaves the event exactly as complete as it was, and re-running
  // resumes.
  if (plan.action !== 'create' && plan.newOccurrences.length > 0) {
    const { error } = await admin.from('event_occurrences').insert(
      plan.newOccurrences.map((occurrence) => ({
        event_id: eventId,
        starts_at: occurrence.startsAt,
        ends_at: occurrence.endsAt,
      })),
    );
    if (error) {
      fail(`Failed to add occurrences for ${entry.sourceKey}: ${error.message}`);
    }
  }

  for (const fix of plan.endsAtFixes) {
    const { error } = await admin
      .from('event_occurrences')
      .update({ ends_at: fix.endsAt })
      .eq('id', fix.id);
    if (error) {
      fail(`Failed to set end time for ${entry.sourceKey} ${fix.startsAt}: ${error.message}`);
    }
  }

  if (plan.action !== 'unchanged') {
    console.log(`applied ${entry.sourceKey}`);
  }
}

console.log('\nDone.\n');
