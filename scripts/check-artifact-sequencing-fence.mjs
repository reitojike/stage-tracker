import { spawnSync } from 'node:child_process';
import {
  evaluateArtifactSequencingFence,
  parseChangedFiles,
} from './lib/artifactSequencingFence.mjs';

// PR 単位の deterministic fence（PO 判断 D1 = D）。
//
// migration と、deploy に届く artifact を同一 PR に含めることを拒否する。
// 判定ロジックは lib/ 側の純関数が持ち、ここは git/env の I/O だけを担う
// （check-migration-ordering-fence.mjs と同じ分離）。
//
// BASE_SHA / HEAD_SHA を環境から受け取る（verify.yml の pull_request event
// から配線）。full-history checkout（fetch-depth: 0）が前提。

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA;

if (typeof baseSha !== 'string' || baseSha.length === 0) {
  console.error('BASE_SHA is not set. This check only runs for pull_request events.');
  process.exit(1);
}
if (typeof headSha !== 'string' || headSha.length === 0) {
  console.error('HEAD_SHA is not set. This check only runs for pull_request events.');
  process.exit(1);
}

// **three-dot（merge-base 起点）で取る。** two-dot（`git diff A B`）だと、
// branch を切ってから main 側が進んだぶんの差分まで混ざり、この PR が
// 触っていないファイルを blocked として報告してしまう。
// `-z` を付ける理由: 既定の `core.quotepath=true` では、非 ASCII を含む path が
// `"supabase/migrations/æ..."` のように quote/escape されて返る。すると
// 先頭の `"` のせいで allowlist の正規表現に一致せず、**その file が黙って
// 素通りする**（fail open）。この fence は「漏れは過剰拒否の側にしか倒れない」
// ことを設計の要点にしているので、ここで閉じる。`-z` は NUL 区切り・quote 無し。
// `--no-renames` を付ける理由: git は既定で rename を検出し、`--name-only` は
// **新しい path しか出さない**。そのため
//
//     supabase/migrations/a.sql  ->  somewhere/a.sql
//
// と移動しながら runtime を変更する PR では、古い path が見えず
// `No migration files in this PR.` で素通りする（実測済み）。
// `--no-renames` なら delete + add として両方の path が出る。
const diff = spawnSync(
  'git',
  ['diff', '--name-only', '-z', '--no-renames', `${baseSha}...${headSha}`],
  { encoding: 'utf8' },
);
if (diff.error || diff.status !== 0) {
  console.error('Failed to diff the pull request range.');
  if (diff.error) console.error(diff.error.message);
  if (diff.stderr) console.error(diff.stderr);
  process.exit(1);
}

const result = evaluateArtifactSequencingFence(parseChangedFiles(diff.stdout));

if (result.ok) {
  console.log(`OK: ${result.reason}`);
  process.exit(0);
}

console.error('Artifact sequencing fence failed.');
console.error('');
console.error('  database migrations:');
for (const f of result.migrations) console.error(`    ${f}`);
console.error('  files that can reach a deployment:');
for (const f of result.blocked) console.error(`    ${f}`);
console.error('');
console.error(result.reason);
console.error('');
console.error('See docs/v2/decisions.md (PO 判断: D1 = D) for why this is enforced.');
process.exit(1);
