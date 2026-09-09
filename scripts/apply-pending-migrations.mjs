import { spawnSync } from 'node:child_process';
import { classifyMigrationDrift } from './lib/migrationDrift.mjs';
import { planMigrationApply } from './lib/migrationApplyPlan.mjs';

// main へ merge された migration を Production へ適用する（PO 判断 D1 = D）。
//
// ## これが小さくて済む理由
//
// **deploy と協調しない。** PR #388（案 C）は「commit A の schema を用意して
// から commit A を deploy する」を保証しようとして、動き続ける main と単一の
// Production DB に対する TOCTOU に阻まれた（4 ラウンド連続で P1、330 行）。
//
// D では artifact sequencing fence により **migration と app code が同じ PR に
// 同居しない**ため、適用と deploy の順序を合わせる必要が無い。expand
// migration は current production app と後方互換であることが条件なので、
// 適用が deploy の前後どちらでも壊れない。
//
// したがってこのスクリプトは「pending があれば適用する」だけでよい。
// target SHA の一致確認も、deploy の抑止も、復旧経路も要らない。
//
// ## それでも譲らないこと
//
//   pendingLocal のみ -> apply
//   remoteOnly あり   -> **止める**。repository に対応するファイルが無い
//                        migration が Production にある状態で、その上に
//                        local を重ねてはいけない
//   unknown           -> 止める。「何も無い」という証拠ではない
//
// 接続は SUPABASE_DB_URL（Postgres の接続文字列）のみ。Supabase の Personal
// Access Token は scope 設定が無くアカウント配下の全 project に届くため
// 使わない。到達範囲をその 1 データベースに限定する。

const dbUrl = process.env.SUPABASE_DB_URL;
if (dbUrl === undefined || dbUrl.length === 0) {
  console.error('UNKNOWN: SUPABASE_DB_URL is not set.');
  console.error('This is not evidence that there is nothing to apply.');
  process.exit(2);
}

function listMigrations() {
  const result = spawnSync(
    'supabase',
    ['migration', 'list', '--db-url', dbUrl, '--output-format', 'json'],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.error || result.status !== 0) {
    console.error('UNKNOWN: failed to list migrations for the Production database.');
    if (result.error) console.error(result.error.message);
    if (result.stderr) console.error(result.stderr);
    process.exit(2);
  }
  const jsonLine = result.stdout.split('\n').find((l) => l.trim().startsWith('{'));
  try {
    return JSON.parse(jsonLine ?? '');
  } catch (error) {
    console.error('UNKNOWN: could not parse `supabase migration list` output.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

const plan = planMigrationApply(classifyMigrationDrift(listMigrations()));

if (plan.action === 'stop') {
  console.error(`STOP: ${plan.reason}`);
  console.error('Investigate before applying anything on top of this state.');
  process.exit(plan.cause === 'remote-only' ? 1 : 2);
}

if (plan.action === 'skip') {
  console.log(`Nothing to apply. ${plan.reason}`);
  process.exit(0);
}

console.log(`Applying ${String(plan.pending.length)} pending migration(s):`);
for (const m of plan.pending) console.log(`  ${m}`);

// --include-all: 並行 migration PR の merge 順序次第で、version の大きい
// migration が先に適用され、後から merge された version の小さい migration
// が remote history 上「未来」に取り残されることがある。デフォルトの
// db push はそれを対象に含めないため、pendingLocal と分類した migration が
// 実際には適用されない fail-open になる（#397 review, Codex P1）。
// --skip-vault: config.toml の [db.vault] は現在コメントアウトだが、この
// workflow の契約は「merged migration の適用」に閉じる。vault sync を
// 明示的に対象外にする。
// --yes: CI は non-TTY だが、それに暗黙で依存せず明示する。
const push = spawnSync(
  'supabase',
  ['db', 'push', '--db-url', dbUrl, '--include-all', '--skip-vault', '--yes'],
  {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);
if (push.error || push.status !== 0) {
  console.error('Failed to apply migrations.');
  process.exit(1);
}

// 適用後にもう一度 plan を取り、skip（pending も remote-only も無い）である
// ことを確認する。別のチェッカーを使わず同じコード経路で確認するので、
// 判定の食い違いが生まれない。
const after = planMigrationApply(classifyMigrationDrift(listMigrations()));
if (after.action !== 'skip') {
  console.error(`Migrations still not settled after apply (action=${after.action}).`);
  console.error(after.reason);
  process.exit(1);
}

console.log('All migrations applied. Production matches the repository.');
