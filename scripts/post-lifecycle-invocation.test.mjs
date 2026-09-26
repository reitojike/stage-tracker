import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
function runPackageScript(script, args) {
  const command = ['corepack', 'pnpm', 'run', script, ...args].join(' ');
  return spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    timeout: 10_000,
    windowsHide: true,
    shell: true,
  });
}

test('post-pr create invocation is forwarded by the package script without a separator', () => {
  const result = runPackageScript('post-pr:converge', [
    '--create',
    '--title',
    'smoke-title',
    '--body',
    'smoke-body',
    '--ci-timeout-seconds',
    '30',
    '--review-timeout-seconds',
    '30',
    '--poll-seconds',
    '0',
    '--correction-attempt',
    '1',
    '--once',
    '--json',
    '--help',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/u);
  assert.doesNotMatch(result.stdout + result.stderr, /unknown option: --/u);
});

test('post-pr create accepts the documented body-file option through the package script', () => {
  const result = runPackageScript('post-pr:converge', [
    '--create',
    '--title',
    'smoke-title',
    '--body-file',
    'package.json',
    '--help',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/u);
  assert.doesNotMatch(result.stdout + result.stderr, /unknown option: --/u);
});

test('post-pr existing-PR invocation is forwarded by the package script', () => {
  const result = runPackageScript('post-pr:converge', [
    '--pr',
    '731',
    '--once',
    '--json',
    '--help',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/u);
  assert.doesNotMatch(result.stdout + result.stderr, /unknown option: --/u);
});

test('post-merge positional command and guarded flags are forwarded by the package script', () => {
  const result = runPackageScript('post-merge:closure', [
    'snapshot',
    '--repo',
    'owner/name',
    '--issue',
    '732',
    '--pr',
    '731',
    '--allow-completion',
    '--semantic-ac-verified',
    '--no-known-remaining-work',
    '--json',
    '--help',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/u);
  assert.doesNotMatch(result.stdout + result.stderr, /unknown option: --/u);
});

test('both lifecycle package scripts continue to reject unknown options', () => {
  const postPr = runPackageScript('post-pr:converge', ['--unknown']);
  const postMerge = runPackageScript('post-merge:closure', ['snapshot', '--unknown']);

  assert.notEqual(postPr.status, 0);
  assert.match(postPr.stdout + postPr.stderr, /unknown option: --unknown/u);
  assert.notEqual(postMerge.status, 0);
  assert.match(postMerge.stdout + postMerge.stderr, /unknown option: --unknown/u);
});
