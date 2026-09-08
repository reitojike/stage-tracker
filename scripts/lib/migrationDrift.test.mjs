import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMigrationDrift } from './migrationDrift.mjs';
import { planMigrationApply } from './migrationApplyPlan.mjs';

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

// --- fail-closed regression（PR #390 CodeRabbit finding） ---
//
// pending でも remote-only でもない不正な entry が 'synced' へ落ちていた。
// この module の header が宣言する「positive evidence 無しに synced を
// 返さない」に反する。

void test('classifyMigrationDrift reports unknown when a paired entry has mismatched local/remote versions', () => {
  const result = classifyMigrationDrift({
    migrations: [{ local: '20260908000000', remote: '20260908000001' }],
  });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.pendingLocal, []);
  assert.deepEqual(result.remoteOnly, []);
  assert.ok(result.reason.includes('cannot confirm the repository/Production correspondence'));
});

void test('classifyMigrationDrift reports unknown when an entry has neither local nor remote', () => {
  assert.equal(classifyMigrationDrift({ migrations: [{}] }).status, 'unknown');
  assert.equal(
    classifyMigrationDrift({ migrations: [{ local: '', remote: '' }] }).status,
    'unknown',
  );
});

// 前 revision はこの検査を drift の後ろに置き、**壊れた挙動をテストで固定して
// いた**（PR #390 codex finding）。pending と不正 entry が同時に来た場合、
// 'drift' を返すと planMigrationApply が 'apply' を返し、対応が未確認のまま
// Production へ push が走る。'unknown' でなければならない。

void test('classifyMigrationDrift reports unknown when an invalid entry accompanies a real pending one', () => {
  const result = classifyMigrationDrift({
    migrations: [
      { local: '20260908000000', remote: null },
      { local: '20260101000000', remote: '20260101000009' },
    ],
  });
  assert.equal(result.status, 'unknown');
  // pending の詳細は operator が状況を読めるよう payload に残す。
  assert.deepEqual(result.pendingLocal, ['20260908000000']);
});

// この module 単体ではなく、apply path の入口まで通して固定する。
// 「unknown を返す」ことではなく「Production へ push しない」ことが目的。

void test('planMigrationApply stops (never applies) when an invalid entry accompanies a real pending one', () => {
  const plan = planMigrationApply(
    classifyMigrationDrift({
      migrations: [
        { local: '20260908000000', remote: null },
        { local: '20260101000000', remote: '20260101000009' },
      ],
    }),
  );
  assert.equal(plan.action, 'stop');
  assert.equal(plan.cause, 'unknown');
  assert.deepEqual(plan.pending, []);
});

void test('planMigrationApply still applies a genuinely pending-only state', () => {
  const plan = planMigrationApply(
    classifyMigrationDrift({
      migrations: [
        { local: '20260101000000', remote: '20260101000000' },
        { local: '20260908000000', remote: null },
      ],
    }),
  );
  assert.equal(plan.action, 'apply');
  assert.deepEqual(plan.pending, ['20260908000000']);
});
