import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planMigrationApply } from './migrationApplyPlan.mjs';
import { classifyMigrationDrift } from './migrationDrift.mjs';

describe('planMigrationApply', () => {
  it('pending だけなら apply', () => {
    const plan = planMigrationApply({
      status: 'drift',
      pendingLocal: ['20260908000000', '20260908000001'],
      remoteOnly: [],
      reason: null,
    });
    assert.equal(plan.action, 'apply');
    assert.deepEqual(plan.pending, ['20260908000000', '20260908000001']);
  });

  it('同期済みなら skip', () => {
    const plan = planMigrationApply({
      status: 'synced',
      pendingLocal: [],
      remoteOnly: [],
      reason: '55 migration(s) match.',
    });
    assert.equal(plan.action, 'skip');
  });

  // ここが check-migration-drift.mjs との違い。あちらは pending と
  // remote-only をまとめて drift（exit 1）にするが、release では
  // 「適用してよい」と「止めるべき」を取り違えてはいけない。
  it('remote-only があれば stop（pending があっても apply しない）', () => {
    const plan = planMigrationApply({
      status: 'drift',
      pendingLocal: ['20260908000000'],
      remoteOnly: ['20260101000000'],
      reason: null,
    });
    assert.equal(plan.action, 'stop');
    // exit code を分けるのは message の文字列一致ではなく discriminant。
    assert.equal(plan.cause, 'remote-only');
    assert.equal(plan.pending.length, 0);
  });

  it('unknown は stop。「何も無い」に潰さない', () => {
    const plan = planMigrationApply({
      status: 'unknown',
      pendingLocal: [],
      remoteOnly: [],
      reason: 'Response did not contain a migrations array.',
    });
    assert.equal(plan.action, 'stop');
    assert.equal(plan.cause, 'unknown');
  });
});

// --- classifyMigrationDrift と繋いだ end-to-end ---
//
// 上の unit test は合成した classification を直接渡している。実際に
// Production へ `supabase db push` が走るかどうかは、
// **`supabase migration list --output-format json` の生の形**から
// classify -> plan と辿った結果で決まる。ここが Production への write path
// そのものなので、生の形から通して固定する。

describe('classifyMigrationDrift -> planMigrationApply', () => {
  const plan = (migrations) => planMigrationApply(classifyMigrationDrift({ migrations }));

  it('pending のみ → apply', () => {
    const p = plan([
      { local: '20260101000000', remote: '20260101000000' },
      { local: '20260908010000', remote: '' },
    ]);
    assert.equal(p.action, 'apply');
    assert.deepEqual(p.pending, ['20260908010000']);
  });

  it('すべて一致 → skip', () => {
    const p = plan([
      { local: '20260101000000', remote: '20260101000000' },
      { local: '20260908010000', remote: '20260908010000' },
    ]);
    assert.equal(p.action, 'skip');
  });

  it('remote-only があれば stop（pending があっても push しない）', () => {
    const p = plan([
      { local: '20260908010000', remote: '' },
      { local: '', remote: '20260830999999' },
    ]);
    assert.equal(p.action, 'stop');
    assert.equal(p.cause, 'remote-only');
    assert.deepEqual(p.pending, []);
  });

  // **これが一番効く。** 対応の確認できない entry が pending と混在する場合、
  // pendingLocal だけを見て apply すると、repository と Production の対応が
  // 未確認のまま Production へ書き込む。
  it('対応不明な entry が pending と混在 → stop。push しない', () => {
    const p = plan([
      { local: '20260908010000', remote: '' },
      { local: '20260101000000', remote: '20260101000009' },
    ]);
    assert.equal(p.action, 'stop');
    assert.equal(p.cause, 'unknown');
    assert.deepEqual(p.pending, []);
  });

  it('出力が壊れていれば stop', () => {
    assert.equal(planMigrationApply(classifyMigrationDrift(null)).action, 'stop');
    assert.equal(planMigrationApply(classifyMigrationDrift({ migrations: 'nope' })).action, 'stop');
  });
});
