// PO 判断 D1 = D（`docs/v2/decisions.md`）の deterministic fence。
//
// **DB 変更と、それを必要とする runtime 変更を同一 PR に含めない。**
//
// Issue #121 / #124 / #125 は、同じ PR に migration とそれを即座に参照する
// app code が同居していたために、「migration がまだ Production に無いのに
// 新 schema 必須の app が先に deploy される」状態を作れてしまったのが原因
// だった。**その状態を作れなくする。**
//
//   PR A  expand migration のみ   -> Production へ適用 -> merge
//   PR B  app code のみ           -> 通常の auto-deploy
//   PR C  contract migration のみ -> 新 app が十分稼働した後
//
// ## 責務の分離
//
// この checker が判定するのは **deterministic fact**（migration と runtime
// code が同じ PR にあるか）だけ。「この migration は後方互換な expand か」
// という **semantic judgment** は agent / reviewer が行う。
//
// ## どちら側を先に出すかは、この checker の管轄ではない
//
// 上の A -> B -> C は「column/table を *足す*」変更の順序。**DB が出す値を
// *変える* 変更では順序が逆になる。**
//
//   error code（SQLSTATE）の変更:
//   PR A  client が新旧どちらの code も受け付ける（runtime）
//   PR B  migration が code を切り替える
//   PR C  旧 code の分岐を撤去する（runtime）
//
// `raise ... using errcode` は **1 つの値しか持てない**ので、DB 側だけで
// 「新旧どちらの code も出す」expand はできない。読む側を先に広げないと、
// 切り替えた瞬間に既存 client が分類に失敗する。**writer が新しい語彙を
// 話し始める前に、reader が両方を理解できる状態にしておく。**
//
// この checker は「同居しているか」しか見ないので、どちらを先に出すかは
// reviewer が判断する（PR #389 の review finding で実際に間違えた）。
//
// ## なぜ release orchestrator ではなくこれなのか
//
// PR #388 で「GitHub Actions が migration -> deploy の順序を保証する」案を
// 実装したが、単一 DB への write と Git ref の移動を共通 transaction に
// 載せられないため、check を増やしても TOCTOU が閉じなかった（4 ラウンド
// 連続で P1）。**順序を pipeline で保証するのをやめ、artifact の構造に
// 埋め込む。**

const MIGRATION_PATTERN = /^supabase\/migrations\/.+\.sql$/;

// migration と同居してよい path。**exact path の allowlist にする。**
//
// `/\/database\.types\.ts$/` のような suffix 一致にすると、
// `apps/web/src/feature/database.types.ts` のような**手書きの runtime module**
// を同じ名前で置くだけで fence を迂回できる（CodeRabbit の指摘）。
// 生成物の出力先は `apps/legacy-web/scripts/generate-supabase-types.mjs` が
// 知っている 2 箇所だけなので、その 2 つを literal で書く。
//
// 追加するときは「これが deploy 後の runtime 挙動を変え得るか」で判断すること。
// **「ついでに直したくなる」ものを足していくと fence の意味が無くなる。**
const ALLOWED_ALONGSIDE_PATHS = new Set([
  'apps/web/src/lib/data/database.types.ts',
  'apps/legacy-web/src/infrastructure/supabase/database.types.ts',
]);

// deploy される runtime とみなす path。**migration と同居したら拒否する。**
//
// **境界は `apps/*/src/` ではなく `apps/**` と `packages/**` そのもの。**
//
// 当初は `/^apps\/[^/]+\/src\//` としていたが、これでは次がすべて漏れた
// （PR #390 codex finding）。
//
//   packages/domain/src/**   apps/web の workspace dependency。bundle に入る
//   packages/ui/src/**       同上
//   apps/web/package.json    依存の変更は bundle を変える
//   apps/web/next.config.ts  runtime の挙動を変える
//
// **列挙を反転した理由**: 「runtime に当たる path を数え上げる」設計は、
// 数え漏れが必ず穴になる（実際 2 ラウンド続けて「これも漏れている」という
// finding が出た）。deploy 対象の境界そのもの（`apps/` と `packages/`）を
// runtime とし、**そこに新しい package や app が増えても既定で拒否される**
// 形にする。例外は下の exact path だけ。
//
// 逆に `scripts/**` `.github/**` `docs/**` `supabase/**` は deploy されない
// ので同居してよい。
const RUNTIME_PATTERN = /^(apps|packages)\//;

// `apps/**` / `packages/**` の中にあっても **deploy されない** subtree / file。
//
// ここを除外しないと、`docs/v2/decisions.md` が定める手順
// 「PR A — Expand: migration + DB tests だけ」（同ファイル）と矛盾し、
// **migration に対応する RLS / pgTAP 回帰テストを同じ PR で出せなくなる**
// （PR #390 codex finding）。
//
// ## 誤りがどちら側に落ちるか
//
// 上の `RUNTIME_PATTERN` が「`apps/` と `packages/` は既定で runtime」と
// しているので、**この除外リストの漏れは「過剰に拒否する」方向にしか
// 効かない**。穴（危険側）ではなく不便（安全側）に倒れる。
//
// 逆に runtime 側を列挙する設計だと、漏れがそのまま穴になる。2 ラウンド
// 続けてその型の finding が出たので、この非対称性を保つことを設計判断とする。
const NOT_DEPLOYED_PATTERNS = [
  // DB/RLS/auth test、E2E、operator/CI script
  /^apps\/[^/]+\/(test|tests|e2e|scripts)\//,
  /^packages\/[^/]+\/(test|tests)\//,
  // src 配下に同居する test / story
  /\.(test|spec|stories)\.[cm]?[jt]sx?$/,
];

export function parseChangedFiles(diffNameOnlyOutput) {
  if (typeof diffNameOnlyOutput !== 'string' || diffNameOnlyOutput.length === 0) return [];
  return diffNameOnlyOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function evaluateArtifactSequencingFence(changedFiles) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const migrations = files.filter((f) => MIGRATION_PATTERN.test(f));

  if (migrations.length === 0) {
    return { ok: true, migrations: [], runtime: [], reason: 'No migration files in this PR.' };
  }

  const runtime = files.filter(
    (f) =>
      RUNTIME_PATTERN.test(f) &&
      !ALLOWED_ALONGSIDE_PATHS.has(f) &&
      !NOT_DEPLOYED_PATTERNS.some((p) => p.test(f)),
  );

  if (runtime.length === 0) {
    return {
      ok: true,
      migrations,
      runtime: [],
      reason: `${String(migrations.length)} migration(s), no runtime code. Expand/contract PR.`,
    };
  }

  return {
    ok: false,
    migrations,
    runtime,
    reason:
      'This PR changes both database migrations and application runtime code. ' +
      'Split it: land the migration first (expand, backward-compatible with the ' +
      'currently deployed app), then the application code in a follow-up PR.',
  };
}
