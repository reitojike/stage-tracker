import { spawnSync } from 'node:child_process';
import {
  evaluateArtifactSequencingFence,
  parseChangedFiles,
} from './lib/artifactSequencingFence.mjs';

// PR 単位の deterministic fence（PO 判断 D1 = D）。
//
// DB 変更と、それを必要とする runtime 変更を同一 PR に含めることを拒否する。
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

const diff = spawnSync('git', ['diff', '--name-only', baseSha, headSha], { encoding: 'utf8' });
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
console.error('  migrations:');
for (const f of result.migrations) console.error(`    ${f}`);
console.error('  application runtime code:');
for (const f of result.runtime) console.error(`    ${f}`);
console.error('');
console.error(result.reason);
console.error('');
console.error('See docs/v2/decisions.md (PO 判断: D1 = D) for why this is enforced.');
process.exit(1);
