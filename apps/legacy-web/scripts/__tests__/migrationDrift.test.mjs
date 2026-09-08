import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMigrationDrift } from '../lib/migrationDrift.mjs';

void test('classifyMigrationDrift reports unknown for null input', () => {
  const { status } = classifyMigrationDrift(null);
  assert.equal(status, 'unknown');
});

void test('classifyMigrationDrift reports unknown when migrations is not an array', () => {
  const { status } = classifyMigrationDrift({ migrations: 'not-an-array' });
  assert.equal(status, 'unknown');
});

void test('classifyMigrationDrift reports unknown for a plain non-object', () => {
  assert.equal(classifyMigrationDrift('oops').status, 'unknown');
  assert.equal(classifyMigrationDrift(undefined).status, 'unknown');
});

void test('classifyMigrationDrift reports synced for an empty migrations array', () => {
  const { status, pendingLocal, remoteOnly } = classifyMigrationDrift({ migrations: [] });
  assert.equal(status, 'synced');
  assert.deepEqual(pendingLocal, []);
  assert.deepEqual(remoteOnly, []);
});

void test('classifyMigrationDrift reports synced when every local matches a remote', () => {
  const parsed = {
    migrations: [
      { local: '20260820000000', remote: '20260820000000', time: '2026-08-20 00:00:00' },
      { local: '20260821000000', remote: '20260821000000', time: '2026-08-21 00:00:00' },
    ],
  };
  const { status } = classifyMigrationDrift(parsed);
  assert.equal(status, 'synced');
});

void test('classifyMigrationDrift flags pending local-only migrations as drift', () => {
  const parsed = {
    migrations: [
      { local: '20260820000000', remote: '20260820000000', time: '2026-08-20 00:00:00' },
      { local: '20260826000200', remote: '', time: '2026-08-26 00:02:00' },
    ],
  };
  const { status, pendingLocal, remoteOnly } = classifyMigrationDrift(parsed);
  assert.equal(status, 'drift');
  assert.deepEqual(pendingLocal, ['20260826000200']);
  assert.deepEqual(remoteOnly, []);
});

void test('classifyMigrationDrift flags remote-only migrations as drift', () => {
  const parsed = {
    migrations: [{ local: '', remote: '20260826000300', time: '2026-08-26 00:03:00' }],
  };
  const { status, pendingLocal, remoteOnly } = classifyMigrationDrift(parsed);
  assert.equal(status, 'drift');
  assert.deepEqual(pendingLocal, []);
  assert.deepEqual(remoteOnly, ['20260826000300']);
});

void test('classifyMigrationDrift treats a missing field the same as an empty string', () => {
  const parsed = { migrations: [{ local: '20260826000200', time: '2026-08-26 00:02:00' }] };
  const { status, pendingLocal } = classifyMigrationDrift(parsed);
  assert.equal(status, 'drift');
  assert.deepEqual(pendingLocal, ['20260826000200']);
});

void test('classifyMigrationDrift can report both pending and remote-only in one run', () => {
  const parsed = {
    migrations: [
      { local: '20260826000200', remote: '', time: '2026-08-26 00:02:00' },
      { local: '', remote: '20260826999999', time: '2026-08-26 99:99:99' },
    ],
  };
  const { status, pendingLocal, remoteOnly } = classifyMigrationDrift(parsed);
  assert.equal(status, 'drift');
  assert.deepEqual(pendingLocal, ['20260826000200']);
  assert.deepEqual(remoteOnly, ['20260826999999']);
});

// --- fail closed の regression ---
//
// `supabase:migrations:drift -- --linked` の結果は、D contract の
// 「Production apply -> drift=0 -> merge」で **merge の evidence** に使われる。
// 判定できない状態を synced / drift として返すと、その evidence が嘘になる。

void test('classifyMigrationDrift reports unknown when a paired entry has mismatched versions', () => {
  const result = classifyMigrationDrift({
    migrations: [{ local: '20260908000000', remote: '20260908000001' }],
  });
  assert.equal(result.status, 'unknown');
});

void test('classifyMigrationDrift reports unknown when an entry has neither local nor remote', () => {
  assert.equal(classifyMigrationDrift({ migrations: [{}] }).status, 'unknown');
  assert.equal(
    classifyMigrationDrift({ migrations: [{ local: '', remote: '' }] }).status,
    'unknown',
  );
});

// 一番効くのはここ。pending があると drift の early return に先に当たり、
// 呼び出し側は pendingLocal だけを見て「適用すれば揃う」と読んでしまう。
void test('classifyMigrationDrift reports unknown when an invalid entry accompanies a real pending one', () => {
  const result = classifyMigrationDrift({
    migrations: [
      { local: '20260908000000', remote: null },
      { local: '20260101000000', remote: '20260101000009' },
    ],
  });
  assert.equal(result.status, 'unknown');
  // 読み取れた範囲は operator の手がかりとして残す（sync の主張ではない）。
  assert.deepEqual(result.pendingLocal, ['20260908000000']);
});

void test('classifyMigrationDrift still reports drift for a genuinely pending-only state', () => {
  const result = classifyMigrationDrift({
    migrations: [
      { local: '20260101000000', remote: '20260101000000' },
      { local: '20260908000000', remote: null },
    ],
  });
  assert.equal(result.status, 'drift');
  assert.deepEqual(result.pendingLocal, ['20260908000000']);
});
