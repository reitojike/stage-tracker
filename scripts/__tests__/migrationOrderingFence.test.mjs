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

void test('extractMigrationOrdering reads the classification and Production apply evidence', () => {
  const body = [
    '## Migration ordering',
    '',
    'Migration ordering: schema-first-required',
    'Production migration applied: pushed to Production via `supabase db push --linked` at 2026-08-27',
  ].join('\n');
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'schema-first-required');
  assert.match(result.productionApplyEvidence, /supabase db push/);
});

void test('extractMigrationOrdering is case-insensitive and tolerates markdown emphasis', () => {
  const body = '**Migration Ordering:** `POST-DEPLOY-SAFE`';
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'post-deploy-safe');
});

void test('extractMigrationOrdering returns nulls when markers are absent', () => {
  const result = extractMigrationOrdering('Just a normal PR description.');
  assert.equal(result.classification, null);
  assert.equal(result.productionApplyEvidence, null);
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

void test('evaluateMigrationOrderingFence passes for post-deploy-safe with no further requirement', () => {
  const { ok } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: 'Migration ordering: post-deploy-safe',
  });
  assert.equal(ok, true);
});

void test('evaluateMigrationOrderingFence fails for schema-first-required without Production apply evidence', () => {
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: 'Migration ordering: schema-first-required',
  });
  assert.equal(ok, false);
  assert.match(reason, /Production migration applied/);
});

void test('evaluateMigrationOrderingFence passes for schema-first-required with Production apply evidence', () => {
  const { ok } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody:
      'Migration ordering: schema-first-required\nProduction migration applied: db push --linked confirmed',
  });
  assert.equal(ok, true);
});

void test('extractMigrationOrdering ignores marker-like text inside an HTML comment', () => {
  const body = [
    'Migration ordering: schema-first-required',
    '<!--',
    'Production migration applied: <short evidence, e.g. "supabase db push --linked">',
    '-->',
  ].join('\n');
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, 'schema-first-required');
  assert.equal(result.productionApplyEvidence, null);
});

void test('extractMigrationOrdering flags ambiguous when both template marker lines are left uncommented', () => {
  const body = 'Migration ordering: post-deploy-safe\nMigration ordering: schema-first-required';
  const result = extractMigrationOrdering(body);
  assert.equal(result.classification, null);
  assert.equal(result.ambiguous, true);
});

void test('evaluateMigrationOrderingFence fails when the unedited PR template ships both marker lines', () => {
  const body = 'Migration ordering: post-deploy-safe\nMigration ordering: schema-first-required';
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: body,
  });
  assert.equal(ok, false);
  assert.match(reason, /more than one/);
});

void test('evaluateMigrationOrderingFence rejects placeholder evidence left inside the template HTML comment', () => {
  const body = [
    'Migration ordering: schema-first-required',
    '<!--',
    'Production migration applied: <short evidence, e.g. "supabase db push --linked">',
    '-->',
  ].join('\n');
  const { ok, reason } = evaluateMigrationOrderingFence({
    addedMigrationFiles: ['supabase/migrations/20260827000000_add_thing.sql'],
    prBody: body,
  });
  assert.equal(ok, false);
  assert.match(reason, /Production migration applied/);
});
