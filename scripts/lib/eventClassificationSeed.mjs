// Pure (no-DB) shape validation for the Event genre/group classification
// fields on a catalog-import seed entry (Issue #167, PO decision #158).
//
// Mirrors the split scripts/import-catalog-events.mjs's own validateEntry
// already draws between "is this shaped correctly" (here) and "does it
// resolve against the current catalog" (import-catalog-events.mjs's own
// plan phase, which needs a DB client to diff against the current
// genre_id/event_groups state). Kept separate so the shape rules are
// unit-testable without a running Supabase instance.
//
// `genre` is deliberately validated only as "a non-empty string, or
// null" here, never against a hard-coded closed set of keys: #158
// requires Gate A's 3 genres not be a permanent closed world, and this
// script must not become a second place (besides the genres table
// itself) that needs editing when a genre is added. Whether a given key
// actually names a known genre is checked against the live `genres`
// table during the plan phase (and, as the real authority, by
// import_event_classification's own "unknown genre key" check at apply
// time) - see import-catalog-events.mjs.

function trimmedStringOrNull(value) {
  return typeof value === 'string' ? value.trim() : null;
}

/**
 * Validates the optional `genre`/`groups` classification fields on one
 * seed entry. Returns `{ ok: true, classification }` or
 * `{ ok: false, problems }` - never throws (Issue #163's own documented
 * `{ok:false, problems}` contract, which #167 must not regress). Problem
 * strings are not prefixed with a location here - import-catalog-
 * events.mjs's own validateEntry merges these into its single per-entry
 * `problems` list and applies one `where` prefix for the whole entry, the
 * same as every other field it validates.
 *
 * `classification.genre`/`classification.groups` are each one of three
 * states, not two, and the distinction is load-bearing for backward
 * compatibility (Issue #167 "既存seedを突然壊す必要がなければoptional
 * extensionを優先"):
 * - `undefined` - the field was absent from the seed entry entirely: an
 *   old seed with no classification fields at all must leave whatever
 *   the catalog already has completely untouched, not be read as "clear
 *   it".
 * - `null` (genre only) / `[]` (groups only) - the field was present and
 *   explicit: "this re-import removes the Event's genre" / "this
 *   re-import removes every group association" (#158 "genre解除" /
 *   "group削除").
 * - a value - `genre`: the (unresolved) genre key string; `groups`: the
 *   parsed `{key, displayName}` list to upsert/associate.
 */
export function validateClassificationShape(raw) {
  const problems = [];

  const hasGenre = Object.prototype.hasOwnProperty.call(raw ?? {}, 'genre');
  let genre;
  if (hasGenre) {
    const value = raw.genre;
    if (value === null) {
      genre = null;
    } else {
      const trimmed = trimmedStringOrNull(value);
      if (trimmed === null || trimmed.length === 0) {
        problems.push('genre must be a non-empty string or null when present');
      } else {
        genre = trimmed;
      }
    }
  }

  const hasGroups = Object.prototype.hasOwnProperty.call(raw ?? {}, 'groups');
  let groups;
  if (hasGroups) {
    const rawGroups = raw.groups;
    if (!Array.isArray(rawGroups)) {
      problems.push('groups must be an array when present');
    } else {
      const parsed = [];
      const seenKeys = new Set();
      rawGroups.forEach((rawGroup, index) => {
        const key = trimmedStringOrNull(rawGroup?.key);
        const displayName = trimmedStringOrNull(rawGroup?.displayName);
        if (key === null || key.length === 0) {
          problems.push(`groups[${index}].key must be a non-empty string`);
          return;
        }
        if (displayName === null || displayName.length === 0) {
          problems.push(`groups[${index}].displayName must be a non-empty string`);
          return;
        }
        // "duplicate group within one Event seed" (Issue #167 required
        // import validation) - caught here, during shape validation,
        // rather than left to surface only as a DB-level anomaly at
        // --apply time.
        if (seenKeys.has(key)) {
          problems.push(`groups[${index}]: duplicate group key "${key}" within this event`);
          return;
        }
        seenKeys.add(key);
        parsed.push({ key, displayName });
      });
      groups = parsed;
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  return { ok: true, classification: { genre, groups } };
}

/**
 * "duplicate canonical group identity conflict" (Issue #167 required
 * import validation): the same group `key` must name the same canonical
 * group everywhere it appears in one import run. Two seed entries in the
 * same run giving the same key a different `displayName` is an
 * inconsistent definition of one identity, not two Events legitimately
 * sharing a group - if left unrejected, whichever entry happened to apply
 * last would silently win, and depending on iteration order that could
 * even be nondeterministic seed-file-list-order behavior. Checked across
 * the whole run (all entries, all seed files) before anything is applied,
 * the same run-wide scope import-catalog-events.mjs's own duplicate
 * sourceKey check already uses.
 *
 * `entries` is the array of validated entries from validateEntry, each
 * carrying `.sourceKey` and `.classification.groups` (possibly
 * `undefined`). Returns a plain array of problem strings (empty = no
 * conflict).
 */
export function findConflictingGroupDefinitions(entries) {
  const displayNameByKey = new Map();
  const problems = [];
  for (const entry of entries) {
    const groups = entry.classification?.groups;
    if (!Array.isArray(groups)) {
      continue;
    }
    for (const group of groups) {
      const seenDisplayName = displayNameByKey.get(group.key);
      if (seenDisplayName === undefined) {
        displayNameByKey.set(group.key, group.displayName);
      } else if (seenDisplayName !== group.displayName) {
        problems.push(
          `group key "${group.key}" is given conflicting displayName values in this import run: ` +
            `"${seenDisplayName}" vs "${group.displayName}" (at ${entry.sourceKey})`,
        );
      }
    }
  }
  return problems;
}
