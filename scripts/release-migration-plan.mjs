import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { classifyMigrationDrift } from './lib/migrationDrift.mjs';
import { planReleaseMigrations } from './lib/releaseMigrationPlan.mjs';

// Release workflow の migration 判断（Issue #387、PO 判断 D1 = C）。
//
// `check-migration-drift.mjs` は「同期しているか」だけを答え、pending も
// remote-only もまとめて exit 1 にする。release ではこの 2 つを区別しな
// ければならない。
//
//   pendingLocal のみ -> apply してよい（通常の schema 変更）
//   remoteOnly あり   -> **止める**。repository に対応するファイルが無い
//                        migration が Production に適用されている状態で、
//                        Dashboard の手編集やファイル削除/改名が疑われる。
//                        自動で追随してはいけない
//
// 出力は GITHUB_OUTPUT へ書く。
//   plan=apply|skip
//   pending=<カンマ区切り>
//
// Exit codes:
//   0 - 判断できた（plan を出力済み）
//   1 - 止めるべき状態（remote-only drift）
//   2 - unknown（CLI 失敗・auth 失敗・parse 失敗）。**green に潰さない**

// **account 全体に効く access token を使わない。**
// Supabase の Personal Access Token には scope 設定が無く、アカウント配下の
// 全 project を操作できる。`--db-url` なら到達範囲がその 1 データベースに
// 限られる（PR #388、PO からの質問を受けて判明）。
const dbUrl = process.env.SUPABASE_DB_URL;
if (dbUrl === undefined || dbUrl.length === 0) {
  console.error('UNKNOWN: SUPABASE_DB_URL is not set.');
  console.error('This is not evidence that there is nothing to apply - the release must stop.');
  process.exit(2);
}

const result = spawnSync(
  'supabase',
  ['migration', 'list', '--db-url', dbUrl, '--output-format', 'json'],
  { encoding: 'utf8', shell: process.platform === 'win32' },
);

if (result.error || result.status !== 0) {
  console.error('UNKNOWN: failed to list migrations for the Production database.');
  if (result.error) console.error(result.error.message);
  if (result.stderr) console.error(result.stderr);
  console.error('This is not evidence that there is nothing to apply - the release must stop.');
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout);
} catch (error) {
  console.error('UNKNOWN: could not parse `supabase migration list` output.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const plan = planReleaseMigrations(classifyMigrationDrift(parsed));

if (plan.action === 'stop') {
  console.error(`STOP: ${plan.reason}`);
  console.error(
    'Investigate before releasing. The deploy must not run on an unverified Production state.',
  );
  // classification が unknown だった場合と remote-only drift だった場合を
  // 呼び出し側が区別できるよう、exit code を分ける。
  // remote-only drift（1）と unknown（2）を exit code で分ける。
  // message の文字列一致では判断しない（PR #388 review）。
  process.exit(plan.cause === 'remote-only' ? 1 : 2);
}

console.log(`PLAN: ${plan.action}. ${plan.reason}`);
if (plan.pending.length > 0) {
  console.log(`  ${plan.pending.join(', ')}`);
}

const outputPath = process.env.GITHUB_OUTPUT;
if (outputPath !== undefined && outputPath.length > 0) {
  appendFileSync(
    outputPath,
    `plan=${plan.action}
pending=${plan.pending.join(',')}
`,
    'utf8',
  );
}
