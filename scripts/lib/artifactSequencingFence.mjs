// PO 判断 D1 = D（`docs/v2/decisions.md`）の deterministic fence。
//
// **migration と、deploy に届く artifact を同一 PR に含めない。**
//
// Issue #121 / #124 / #125 は、同じ PR に migration とそれを即座に参照する
// app code が同居していたために、「migration がまだ Production に無いのに
// 新 schema 必須の app が先に deploy される」状態を作れてしまったのが原因
// だった。**その状態を作れなくする。**
//
// ## 責務の分離
//
// この checker が判定するのは **deterministic fact**（migration と deploy に
// 届く artifact が同じ PR にあるか）だけ。次はいずれも **semantic judgment**
// であり reviewer が判断する。
//
//   - この migration は後方互換な expand か
//   - **どちらの PR を先に land させるか**
//
// ## 「どちらが先か」はこの checker の管轄ではない
//
// column を足す変更では migration が先でよいが、**DB が出す値を変える変更
// （error code 等）では runtime が先**になる。`raise ... using errcode` は
// 1 つの値しか持てず、「新旧どちらの code も出す」という DB 側だけの expand が
// 原理的にできないため、読む側を先に広げるしかない（PR #389 / #392 で実際に
// 間違えた。`docs/v2/decisions.md`「A8 追補」）。
//
// したがってこの checker のメッセージは順序を指示しない。**artifact を分ける
// ことだけを要求する。**
//
// ## なぜ release orchestrator ではなくこれなのか
//
// PR #388 で「GitHub Actions が migration -> deploy の順序を保証する」案を
// 実装したが、単一 DB への write と Git ref の移動を共通 transaction に
// 載せられないため、check を増やしても TOCTOU が閉じなかった（4 ラウンド
// 連続で P1）。**順序を pipeline で保証するのをやめ、artifact の構造に
// 埋め込む。**

const MIGRATION_DIR = 'supabase/migrations/';
const MIGRATION_SUFFIX = '.sql';

// **正規表現を使わない。** 末尾を固定する正規表現だと、git が許す
// **LF を含む filename** で `.` が LF を跨げず一致しない。その結果その file が
// migration として数えられず、fence が「migration の無い PR」として素通りする
// （fail open。PR #396 review finding）。
//
// 末尾アンカーが「最後の改行の直前」にも一致する挙動も含め、端点の解釈に
// 依存させない。
function isMigrationFile(file) {
  return (
    file.startsWith(MIGRATION_DIR) &&
    file.endsWith(MIGRATION_SUFFIX) &&
    file.length > MIGRATION_DIR.length + MIGRATION_SUFFIX.length
  );
}

// migration を含む PR で同居してよい path。**これ以外はすべて拒否する。**
//
// ## なぜ「runtime を列挙する」のをやめたか
//
// 当初は runtime 側を列挙していた（`apps/*/src/**` -> `apps/**` と
// `packages/**`）。**列挙漏れがそのまま穴になる**ため、PR #390 で 2 ラウンド
// 続けて「これも漏れている」型の finding が出た。
//
//   round 2  `database.types.ts` の suffix 一致で任意の runtime module が迂回できた
//   round 3  `packages/**` と `apps/*/package.json` / `next.config.ts` が漏れていた
//
// さらに `apps/**` / `packages/**` を既定 runtime にしても、**root の
// `package.json` / lockfile / workspace・build config は依然として素通り**する。
// これらも deploy に影響し得る。
//
// **判定を反転する。** deploy に届かないと明示的に認めた path だけを通し、
// それ以外は既定で拒否する。**新しい path・新しい package・root への追加は
// すべて既定で拒否**され、漏れは「過剰に拒否する」方向にしか倒れない。
//
// ## 追加するときの判断
//
// 「これが deploy 後の runtime 挙動を変え得るか」だけで判断する。
// **「ついでに直したくなる」ものを足していくと fence の意味が無くなる。**
// 追加は理由とともに 1 件ずつ足す。
const ALLOWED_ALONGSIDE_PATTERNS = [
  // migration 本体と pgTAP。**`supabase/` を丸ごとは許可しない。**
  //
  // 以前は `/^supabase\/(?!functions\/)/` としていた。これは
  // 「supabase 配下の未知 path は全部安全。ただし functions だけ例外」という
  // **negative exception** で、この fence が捨てたはずの方式が supabase/ の
  // 中にだけ残っていた（PR #396 review finding）。deployable な Supabase
  // artifact が増えるたびに例外を足し続けることになる。
  /^supabase\/migrations\//,
  /^supabase\/tests\//,

  // 文書。deploy されない
  /^docs\//,

  // DB/RLS integration test。`docs/v2/decisions.md` が
  // 「PR A — Expand: migration + DB tests だけ」と定めているので、
  // migration の回帰テストは同居できなければならない
  /^test\/rls\//,

  // `supabase/config.toml` / `supabase/seed.sql` は意図的に入れていない。
  // 実需が出た時点で exact path を理由付きで足す。
];

// migration から生成される artifact。手で書き写すと drift するため
// （実際に起きた）、migration と同じ PR に入る必要がある。
//
// **exact path で持つ。** suffix 一致にすると、同じ名前の手書き module を
// 置くだけで迂回できる（PR #390 round 2 の finding）。出力先は
// `scripts/generate-supabase-types.mjs` が生成する exact path だけ。
const ALLOWED_ALONGSIDE_PATHS = new Set(['apps/web/src/lib/data/database.types.ts']);

function isAllowedAlongsideMigration(file) {
  return (
    ALLOWED_ALONGSIDE_PATHS.has(file) ||
    ALLOWED_ALONGSIDE_PATTERNS.some((pattern) => pattern.test(file))
  );
}

// NUL 区切り（`git diff -z`）と改行区切りの両方を受ける。
//
// `-z` を使うのは、既定の `core.quotepath=true` が非 ASCII を含む path を
// quote/escape して返し、allowlist の正規表現に一致しなくなる（= その file が
// 黙って素通りする fail open）ため。この fence は「漏れは過剰拒否の側にしか
// 倒れない」ことを設計の要点にしているので、ここで閉じる。
//
// 改行区切りも受けておくのは、手で動かすときや test から素の文字列を
// 渡せるようにするため。
export function parseChangedFiles(diffNameOnlyOutput) {
  if (typeof diffNameOnlyOutput !== 'string' || diffNameOnlyOutput.length === 0) return [];

  // NUL を含むなら `git diff -z` の出力。**NUL だけで区切り、trim しない。**
  //
  // 以前は `/[\0\n]/` で分割していたが、git は filename に LF を
  // 許すため、`supabase/migrations/a<LF>b.sql` が `supabase/migrations/a` と
  // `b.sql` に割れ、どちらも migration と判定されず **その migration が
  // 見えなくなる**（fail open。PR #396 review finding）。
  //
  // trim もしない —— path の前後の空白は path の一部。
  if (diffNameOnlyOutput.includes('\0')) {
    return diffNameOnlyOutput.split('\0').filter((file) => file.length > 0);
  }

  // NUL が無いのは、手で動かした場合や test から素の文字列を渡した場合。
  return diffNameOnlyOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function evaluateArtifactSequencingFence(changedFiles) {
  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const migrations = files.filter((f) => isMigrationFile(f));

  if (migrations.length === 0) {
    return { ok: true, migrations: [], blocked: [], reason: 'No migration files in this PR.' };
  }

  const blocked = files.filter((f) => !isAllowedAlongsideMigration(f));

  if (blocked.length === 0) {
    return {
      ok: true,
      migrations,
      blocked: [],
      reason: `${String(migrations.length)} migration(s), nothing else that reaches a deployment.`,
    };
  }

  return {
    ok: false,
    migrations,
    blocked,
    // **順序を指示しない。** どちらを先に land させるかは semantic judgment で、
    // 変更の種類によって逆になる（このファイル冒頭の doc comment 参照）。
    reason:
      'This PR changes database migrations together with files that can reach a deployment. ' +
      'Split them into separate pull requests. Which one to land first is a judgement for the ' +
      'reviewer, not for this check: adding a column is migration-first, but changing a value ' +
      'the database emits (an error code, say) is runtime-first, because the reader has to ' +
      'accept both the old and the new vocabulary before the writer switches.',
  };
}
