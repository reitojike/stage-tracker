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
      'test/rls/personalSchedule.test.ts',
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
  // `supabase/` を丸ごと許可すると、そこだけ negative exception（未知は安全、
  // 例外だけ列挙）に戻ってしまう。deployable な Supabase artifact が増えるたびに
  // 例外を足す羽目になるので、positive な exact set にしてある。
  it('supabase 配下でも許可するのは migrations と tests だけ', () => {
    for (const p of [
      'supabase/functions/hello/index.ts', // supabase functions deploy で deploy される
      'supabase/config.toml',
      'supabase/seed.sql',
      'supabase/whatever-comes-next/x.ts',
    ]) {
      assert.equal(evaluateArtifactSequencingFence([MIGRATION, p]).ok, false, p);
    }
  });

  it('supabase/migrations と supabase/tests は同居できる', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'supabase/migrations/20260908020000_y.sql',
      'supabase/tests/11_x_test.sql',
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.blocked, []);
  });

  // ## rename-out
  //
  // git は既定で rename を検出し、`--name-only` は新しい path しか出さない。
  // CLI 側に `--no-renames` を付けて delete + add にしてある。その出力
  // （旧 path と新 path の両方）を与えたときに拒否できることを固定する。
  //
  // `--no-renames` を外すと CLI からは旧 path が消え、この関数は
  // 「migration が無い PR」として素通しする（実測済み）。
  it('migration を supabase/migrations の外へ移した PR を拒否する', () => {
    const r = evaluateArtifactSequencingFence([
      'supabase/migrations/20260101000000_a.sql', // --no-renames が出す旧 path
      'somewhere/20260101000000_a.sql', // 新 path
      'apps/web/src/a.ts',
    ]);
    assert.equal(r.ok, false);
    assert.deepEqual(r.migrations, ['supabase/migrations/20260101000000_a.sql']);
    assert.deepEqual(r.blocked, ['somewhere/20260101000000_a.sql', 'apps/web/src/a.ts']);
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
  it('生成される exact path だけを許可する', () => {
    const r = evaluateArtifactSequencingFence([
      MIGRATION,
      'apps/web/src/lib/data/database.types.ts',
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

  // git は filename に LF を許す。NUL 区切りの出力を LF でも分割すると path が
  // 割れ、どちらの断片も isMigrationFile に一致せず **その migration が
  // 見えなくなる**（fail open）。NUL 入力では NUL だけで区切る。
  it('path に含まれる LF で分割しない', () => {
    const files = parseChangedFiles('supabase/migrations/20260908_a\nb.sql\0apps/web/src/a.ts\0');
    assert.deepEqual(files, ['supabase/migrations/20260908_a\nb.sql', 'apps/web/src/a.ts']);

    // 分割されていたら migration が 0 件になり、fence が素通りする。
    const r = evaluateArtifactSequencingFence(files);
    assert.equal(r.migrations.length, 1);
    assert.equal(r.ok, false);
    assert.deepEqual(r.blocked, ['apps/web/src/a.ts']);
  });

  // NUL 入力では trim しない —— path の前後の空白は path の一部。
  it('NUL 入力では前後の空白を保つ', () => {
    assert.deepEqual(parseChangedFiles(' apps/web/src/a.ts \0'), [' apps/web/src/a.ts ']);
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
