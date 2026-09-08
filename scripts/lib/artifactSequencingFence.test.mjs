import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateArtifactSequencingFence, parseChangedFiles } from './artifactSequencingFence.mjs';

describe('evaluateArtifactSequencingFence', () => {
  it('migration が無い PR は素通しする', () => {
    assert.equal(evaluateArtifactSequencingFence(['apps/web/src/app/page.tsx']).ok, true);
  });

  it('migration だけの PR を通す（expand / contract）', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'supabase/tests/11_x_test.sql',
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.migrations.length, 1);
  });

  // fence の本題。#121/#124/#125 の事故はこの形だった。
  it('migration と runtime code の同居を拒否する', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'apps/web/src/lib/actions/schedule/schedule-share-write.ts',
    ]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.runtime, ['apps/web/src/lib/actions/schedule/schedule-share-write.ts']);
    assert.match(r.reason, /Split it/u);
  });

  it('legacy 側の runtime も拒否する', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'apps/legacy-web/src/infrastructure/supabase/x.ts',
    ]);
    assert.equal(r.ok, false);
  });

  it('docs と生成 DB 型は同居してよい', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'docs/v2/decisions.md',
      'apps/web/src/lib/data/database.types.ts',
      'apps/legacy-web/src/infrastructure/supabase/database.types.ts',
    ]);
    assert.equal(r.ok, true);
  });

  it('scripts や workflow は runtime 扱いしない', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      '.github/workflows/verify.yml',
      'scripts/lib/x.mjs',
    ]);
    assert.equal(r.ok, true);
  });
});

describe('parseChangedFiles', () => {
  it('空入力は空配列', () => {
    assert.deepEqual(parseChangedFiles(''), []);
    assert.deepEqual(parseChangedFiles(undefined), []);
  });

  it('行を trim して空行を落とす', () => {
    assert.deepEqual(parseChangedFiles('a.ts\n\n  b.ts  \n'), ['a.ts', 'b.ts']);
  });
});

describe('ALLOWED_ALONGSIDE_PATHS', () => {
  // --- allowlist 迂回の regression（PR #390 CodeRabbit finding） ---
  //
  // suffix 一致（`/\/database\.types\.ts$/`）だと、同じ名前の手書き runtime
  // module を置くだけで fence を迂回できた。exact path の allowlist へ変更した。

  it('a hand-written runtime module merely named database.types.ts does NOT get the generated-artifact exemption', () => {
    const result = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'apps/web/src/feature/database.types.ts',
    ]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.runtime, ['apps/web/src/feature/database.types.ts']);
  });

  it('both real generated database.types.ts paths keep the exemption', () => {
    const result = evaluateArtifactSequencingFence([
      'supabase/migrations/20260908010000_x.sql',
      'apps/web/src/lib/data/database.types.ts',
      'apps/legacy-web/src/infrastructure/supabase/database.types.ts',
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.runtime, []);
  });
});
