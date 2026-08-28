import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  findConflictingGroupDefinitions,
  validateClassificationShape,
} from '../lib/eventClassificationSeed.mjs';

// --- genre/groups absence (backward compatibility) ---

void test('an entry with neither genre nor groups leaves both undefined (untouched)', () => {
  const result = validateClassificationShape({});
  assert.equal(result.ok, true);
  assert.equal(result.classification.genre, undefined);
  assert.equal(result.classification.groups, undefined);
});

void test('a legacy seed entry with only pre-existing Event fields is still valid', () => {
  const result = validateClassificationShape({
    sourceKey: 'takarazuka:2026:example:tokyo',
    title: 'Example',
    occurrences: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification.genre, undefined);
  assert.equal(result.classification.groups, undefined);
});

// --- genre ---

void test('genre: null is a valid explicit clear', () => {
  const result = validateClassificationShape({ genre: null });
  assert.equal(result.ok, true);
  assert.equal(result.classification.genre, null);
});

void test('genre: a non-empty string is accepted and trimmed', () => {
  const result = validateClassificationShape({ genre: '  takarazuka  ' });
  assert.equal(result.ok, true);
  assert.equal(result.classification.genre, 'takarazuka');
});

void test('genre: rejects an empty/whitespace-only string', () => {
  const result = validateClassificationShape({ genre: '   ' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('genre must be a non-empty string or null')));
});

void test('genre: rejects a non-string, non-null value', () => {
  const result = validateClassificationShape({ genre: 42 });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('genre must be a non-empty string or null')));
});

void test('genre: no closed-set validation at the shape layer - any non-empty key is accepted here', () => {
  // Existence against the live genres table is checked during planning
  // (import-catalog-events.mjs), not shape validation - #158 requires the
  // 3 Gate A genres not be a hard-coded closed world in this script.
  const result = validateClassificationShape({ genre: 'not-a-real-genre-yet' });
  assert.equal(result.ok, true);
  assert.equal(result.classification.genre, 'not-a-real-genre-yet');
});

// --- groups ---

void test('groups: an empty array is a valid explicit "clear all"', () => {
  const result = validateClassificationShape({ groups: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.classification.groups, []);
});

void test('groups: accepts and trims valid entries', () => {
  const result = validateClassificationShape({
    groups: [{ key: ' takarazuka-tsuki ', displayName: ' 月組 ' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.classification.groups, [
    { key: 'takarazuka-tsuki', displayName: '月組' },
  ]);
});

void test('groups: accepts multiple distinct groups (joint/festival Event)', () => {
  const result = validateClassificationShape({
    groups: [
      { key: 'takarazuka-tsuki', displayName: '月組' },
      { key: 'takarazuka-hoshi', displayName: '星組' },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification.groups.length, 2);
});

void test('groups: rejects a non-array value', () => {
  const result = validateClassificationShape({ groups: 'takarazuka-tsuki' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('groups must be an array')));
});

void test('groups: rejects a malformed entry missing key', () => {
  const result = validateClassificationShape({ groups: [{ displayName: '月組' }] });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('groups[0].key must be a non-empty string')));
});

void test('groups: rejects a malformed entry missing displayName', () => {
  const result = validateClassificationShape({ groups: [{ key: 'takarazuka-tsuki' }] });
  assert.equal(result.ok, false);
  assert.ok(
    result.problems.some((p) => p.includes('groups[0].displayName must be a non-empty string')),
  );
});

void test('groups: rejects an empty-string key/displayName', () => {
  const result = validateClassificationShape({ groups: [{ key: '  ', displayName: '  ' }] });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('groups[0].key must be a non-empty string')));
});

void test('groups: rejects a duplicate group key within the same event', () => {
  const result = validateClassificationShape({
    groups: [
      { key: 'takarazuka-tsuki', displayName: '月組' },
      { key: 'takarazuka-tsuki', displayName: '月組' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('duplicate group key "takarazuka-tsuki"')));
});

void test('collects genre and groups problems together, and every other pre-existing problem is untouched', () => {
  const result = validateClassificationShape({ genre: '', groups: 'not-an-array' });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 2);
});

// --- findConflictingGroupDefinitions ---

void test('findConflictingGroupDefinitions: no conflict across entries with consistent displayName', () => {
  const entries = [
    {
      sourceKey: 'a',
      classification: { groups: [{ key: 'takarazuka-tsuki', displayName: '月組' }] },
    },
    {
      sourceKey: 'b',
      classification: { groups: [{ key: 'takarazuka-tsuki', displayName: '月組' }] },
    },
  ];
  assert.deepEqual(findConflictingGroupDefinitions(entries), []);
});

void test('findConflictingGroupDefinitions: flags the same key with a different displayName across entries', () => {
  const entries = [
    {
      sourceKey: 'a',
      classification: { groups: [{ key: 'idol-meme-tokyo', displayName: 'Meme Tokyo' }] },
    },
    {
      sourceKey: 'b',
      classification: { groups: [{ key: 'idol-meme-tokyo', displayName: 'meme tokyo' }] },
    },
  ];
  const problems = findConflictingGroupDefinitions(entries);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes('idol-meme-tokyo'));
  assert.ok(problems[0].includes('Meme Tokyo'));
  assert.ok(problems[0].includes('meme tokyo'));
});

void test('findConflictingGroupDefinitions: entries with groups undefined (untouched) are skipped, not treated as empty', () => {
  const entries = [
    { sourceKey: 'a', classification: { groups: undefined } },
    {
      sourceKey: 'b',
      classification: { groups: [{ key: 'takarazuka-tsuki', displayName: '月組' }] },
    },
  ];
  assert.deepEqual(findConflictingGroupDefinitions(entries), []);
});
