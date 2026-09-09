import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseAddedMigrationFiles,
  extractMigrationOrdering,
  evaluateMigrationOrderingFence,
} from '../lib/migrationOrderingFence.mjs';

void test('parseAddedMigrationFiles keeps only supabase/migrations/**.sql paths', () => {
  const diff = [
    'supabase/migrations/20260827000000_add_thing.sql',
    'src/domain/foo.ts',
    'supabase/migrations/README.md',
    '',
  ].join('\n');
  assert.deepEqual(parseAddedMigrationFiles(diff), [
    'supabase/migrations/20260827000000_add_thing.sql',
  ]);
});

void test('parseAddedMigrationFiles returns empty for empty or missing diff output', () => {
  assert.deepEqual(parseAddedMigrationFiles(''), []);
  assert.deepEqual(parseAddedMigrationFiles(undefined), []);
});

void test('extractMigrationOrdering reads the classification and runtime dependency evidence', () => {
  const body = [
    '## Migration ordering',
    '',
    'Migration ordering: runtime-first-required',
    'Runtime dependency merged: PR #392 merged 2026-09-08, classifyRpcError accepts 90010/90011',
  ].join('\n');
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'runtime-first-required');
  assert.match(result.runtimeDependencyEvidence, /PR #392/);
});

void test('extractMigrationOrdering is case-insensitive and tolerates markdown emphasis', () => {
  const body = '**Migration Ordering:** `ADDITIVE`';
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'additive');
});

void test('extractMigrationOrdering returns nulls when markers are absent', () => {
  const result = extractMigrationOrdering('Just a normal PR description.');
  assert.equal(result.classification, null);
  assert.equal(result.runtimeDependencyEvidence, null);
});

void test('evaluateMigrationOrderingFence passes when no migration files were added', () => {
  const { ok } = evaluateMigrationOrderingFence({ addedMigrationFiles: [], prBody: '' });
  assert.equal(ok, true);
});

void test('evaluateMigrationOrderingFence fails when migrations were added but no marker is present', () => {
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: 'No marker here.',
  });
  assert.equal(ok, false);
  assert.match(reason, /Migration ordering/);
});

void test('evaluateMigrationOrderingFence passes for additive with no further requirement', () => {
  const { ok } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: 'Migration ordering: additive',
  });
  assert.equal(ok, true);
});

void test('evaluateMigrationOrderingFence fails for runtime-first-required without runtime dependency evidence', () => {
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: 'Migration ordering: runtime-first-required',
  });
  assert.equal(ok, false);
  assert.match(reason, /Runtime dependency merged/);
});

void test('evaluateMigrationOrderingFence passes for runtime-first-required with runtime dependency evidence', () => {
  const { ok } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody:
      'Migration ordering: runtime-first-required\nRuntime dependency merged: PR #392 merged and deployed',
  });
  assert.equal(ok, true);
});

// PR #389 declared the old "post-deploy-safe" vocabulary (code→schema
// direction: #131) for a migration that actually changed an emitted error
// code - a schema→code change (#393). That old vocabulary is retired; an
// author reaching for it should now get an explicit rejection pointing at
// the new marker set, not a silent pass.
void test('evaluateMigrationOrderingFence rejects the retired "post-deploy-safe"/"schema-first-required" vocabulary', () => {
  for (const retired of ['post-deploy-safe', 'schema-first-required']) {
    const { ok, reason } = evaluateMigrationOrderingFence({
      addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
      prBody: `Migration ordering: ${retired}`,
    });
    assert.equal(ok, false, `expected "${retired}" to be rejected`);
    assert.match(reason, /additive/);
    assert.match(reason, /runtime-first-required/);
  }
});

void test('extractMigrationOrdering ignores marker-like text inside an HTML comment', () => {
  const body = [
    'Migration ordering: runtime-first-required',
    '<!--',
    'Runtime dependency merged: <short evidence, e.g. the runtime PR number>',
    '-->',
  ].join('\n');
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'runtime-first-required');
  assert.equal(result.runtimeDependencyEvidence, null);
});

void test('extractMigrationOrdering flags ambiguous when both template marker lines are left uncommented', () => {
  const body = 'Migration ordering: additive\nMigration ordering: runtime-first-required';
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, null);
  assert.equal(result.ambiguous, true);
});

void test('evaluateMigrationOrderingFence fails when the unedited PR template ships both marker lines', () => {
  const body = 'Migration ordering: additive\nMigration ordering: runtime-first-required';
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: body,
  });
  assert.equal(ok, false);
  assert.match(reason, /more than one/);
});

void test('evaluateMigrationOrderingFence rejects placeholder evidence left inside the template HTML comment', () => {
  const body = [
    'Migration ordering: runtime-first-required',
    '<!--',
    'Runtime dependency merged: <short evidence, e.g. the runtime PR number>',
    '-->',
  ].join('\n');
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: body,
  });
  assert.equal(ok, false);
  assert.match(reason, /Runtime dependency merged/);
});

// --- path 解析の fail open regression（PR #396） ---
//
// この parser は scripts/lib/artifactSequencingFence.mjs と**別の copy**なので、
// 向こうの test では守れない。同じ class の穴を両方で塞いだ以上、coverage も
// 対称にしておく（片方だけ正規表現へ戻す refactor を検出できるように）。

void test('parseAddedMigrationFiles accepts NUL-delimited input (git diff -z)', () => {
  assert.deepEqual(
    parseAddedMigrationFiles('supabase/migrations/20260827000000_a.sql\0src/domain/foo.ts\0'),
    ['supabase/migrations/20260827000000_a.sql'],
  );
});

// git は filename に LF を許す。NUL 区切りの record を LF でも分割すると path が
// 割れ、その migration を「追加されていない」とみなす（fail open）。
void test('parseAddedMigrationFiles does not split on an LF inside a path', () => {
  const files = parseAddedMigrationFiles(
    'supabase/migrations/20260827000000_a\nb.sql\0src/domain/foo.ts\0',
  );
  assert.deepEqual(files, ['supabase/migrations/20260827000000_a\nb.sql']);
});

// NUL 入力では trim しない —— path の前後の空白は path の一部。
void test('parseAddedMigrationFiles does not trim NUL-delimited records', () => {
  assert.deepEqual(parseAddedMigrationFiles('supabase/migrations/20260827000000_a.sql \0'), []);
});

// 改行区切り（手で動かした場合・素の文字列）は従来どおり trim する。
void test('parseAddedMigrationFiles still trims newline-delimited input', () => {
  assert.deepEqual(parseAddedMigrationFiles('  supabase/migrations/20260827000000_a.sql  \n'), [
    'supabase/migrations/20260827000000_a.sql',
  ]);
});
