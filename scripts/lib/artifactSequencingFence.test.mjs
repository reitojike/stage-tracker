import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateArtifactSequencingFence, parseChangedFiles } from './artifactSequencingFence.mjs';

const MIGRATION = 'supabase/migrations/20260908010000_x.sql';

describe('evaluateArtifactSequencingFence', () => {
  it('migration が無い PR は素通しする', () => {
    const r = evaluateArtifactSequencingFence([
      'apps/web/src/app/page.tsx',
      'package.json',
      'pnpm-lock.yaml',
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.blocked, []);
  });

  it('migration と DB test だけの PR を通す', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'supabase/tests/11_x_test.sql',
      'apps/legacy-web/test/rls/personalSchedule.test.ts',
      'docs/v2/decisions.md',
    ]);
    assert.equal(r.ok, true);
    assert.equal(r.migrations.length, 1);
  });

  // fence の本題。#121/#124/#125 の事故はこの形だった。
  it('migration と app code の同居を拒否する', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'apps/web/src/lib/actions/schedule/schedule-share-write.ts',
    ]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocked, ['apps/web/src/lib/actions/schedule/schedule-share-write.ts']);
  });

  // 失敗メッセージは「どちらを先に land させるか」を指示しない。
  // error code の変更では runtime が先になる（PR #389 / #392）。
  it('失敗メッセージが land の順序を指示しない', () => {
    const { reason } = evaluateArtifactSequencingFence([MIGRATION, 'apps/web/src/app/page.tsx']);
    assert.match(reason, /Split them into separate pull requests/u);
    assert.match(reason, /judgement for the reviewer/u);
    // 「migration を先に」と読める断定が無いこと。
    assert.doesNotMatch(reason, /land the migration first/iu);
  });
});

describe('deploy に届く artifact は既定で拒否する', () => {
  // ## この fence の設計判断
  //
  // runtime 側を列挙する方式は、漏れがそのまま穴になった（round 2 は
  // `database.types.ts` の suffix 一致、round 3 は `packages/**` と
  // app 直下の設定）。`apps/**` / `packages/**` を既定 runtime にしても
  // root の `package.json` / lockfile / build config が素通りする。
  //
  // 判定を反転し、**明示的に許可した path 以外は既定で拒否**する。

  it('root の build / dependency 設定を拒否する', () => {
    for (const p of ['package.json', 'pnpm-lock.yaml', 'turbo.json', 'pnpm-workspace.yaml']) {
      assert.equal(evaluateArtifactSequencingFence([MIGRATION, p]).ok, false, p);
    }
  });

  it('workspace package を拒否する', () => {
    for (const p of ['packages/domain/src/event.ts', 'packages/ui/src/Button.tsx']) {
      assert.equal(evaluateArtifactSequencingFence([MIGRATION, p]).ok, false, p);
    }
  });

  it('app 直下の runtime 設定を拒否する', () => {
    for (const p of ['apps/web/package.json', 'apps/web/next.config.ts']) {
      assert.equal(evaluateArtifactSequencingFence([MIGRATION, p]).ok, false, p);
    }
  });

  // 誤りが安全側に落ちること。列挙方式に戻すとこれが通ってしまう。
  // Edge Function は `supabase functions deploy` で実際に deploy される。
  // `^supabase/` を丸ごと許可すると、migration と同居してこの fence が防ぐはずの
  // schema race を再現できてしまう。現時点でこの directory は存在しない。
  it('supabase/functions は deploy されるので拒否する', () => {
    const r = evaluateArtifactSequencingFence([MIGRATION, 'supabase/functions/hello/index.ts']);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocked, ['supabase/functions/hello/index.ts']);
  });

  it('supabase 配下の他の path は引き続き許可する', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'supabase/tests/11_x_test.sql',
      'supabase/config.toml',
      'supabase/seed.sql',
    ]);
    assert.equal(r.ok, true);
  });

  it('未知の path は既定で拒否する（fail closed）', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'packages/whatever-comes-next/src/index.ts',
      'apps/some-future-app/src/index.ts',
      'vercel.json',
      'infra/terraform/main.tf',
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.blocked.length, 4);
  });
});

describe('生成 DB 型の例外', () => {
  it('生成される 2 つの exact path だけを許可する', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'apps/web/src/lib/data/database.types.ts',
      'apps/legacy-web/src/infrastructure/supabase/database.types.ts',
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.blocked, []);
  });

  // suffix 一致だと、同じ名前の手書き module を置くだけで迂回できた。
  it('同名の手書き module には例外を与えない', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'apps/web/src/feature/database.types.ts',
    ]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocked, ['apps/web/src/feature/database.types.ts']);
  });
});

describe('parseChangedFiles', () => {
  it('空入力は空配列', () => {
    assert.deepEqual(parseChangedFiles(''), []);
    assert.deepEqual(parseChangedFiles(undefined), []);
  });

  // `git diff -z` の出力。既定の core.quotepath が非 ASCII path を quote して
  // 返すと allowlist の正規表現に一致せず、その file が黙って素通りする
  // （fail open）ため、呼び出し側は -z を使う。
  it('NUL 区切り（git diff -z）を受け付ける', () => {
    assert.deepEqual(parseChangedFiles('supabase/migrations/x.sql\0apps/web/src/a.ts\0'), [
      'supabase/migrations/x.sql',
      'apps/web/src/a.ts',
    ]);
  });

  it('NUL 区切りの非 ASCII path をそのまま扱える', () => {
    const files = parseChangedFiles('supabase/migrations/20260908_\u65e5\u672c.sql\0');
    assert.deepEqual(files, ['supabase/migrations/20260908_\u65e5\u672c.sql']);
    // quote された形（`"..."`）で来ていたら、この migration が検出されない。
    assert.equal(evaluateArtifactSequencingFence(files).migrations.length, 1);
  });

  it('行を trim して空行を落とす', () => {
    assert.deepEqual(parseChangedFiles('a.ts\n\n  b.ts  \n'), ['a.ts', 'b.ts']);
  });
});
