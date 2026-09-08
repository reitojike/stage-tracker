import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planReleaseMigrations } from './releaseMigrationPlan.mjs';

describe('planReleaseMigrations', () => {
  it('pending だけなら apply', () => {
    const plan = planReleaseMigrations({
      status: 'drift',
      pendingLocal: ['20260908000000', '20260908000001'],
      remoteOnly: [],
      reason: null,
    });
    assert.equal(plan.action, 'apply');
    assert.deepEqual(plan.pending, ['20260908000000', '20260908000001']);
  });

  it('同期済みなら skip', () => {
    const plan = planReleaseMigrations({
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
    const plan = planReleaseMigrations({
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
    const plan = planReleaseMigrations({
      status: 'unknown',
      pendingLocal: [],
      remoteOnly: [],
      reason: 'Response did not contain a migrations array.',
    });
    assert.equal(plan.action, 'stop');
    assert.equal(plan.cause, 'unknown');
  });
});
