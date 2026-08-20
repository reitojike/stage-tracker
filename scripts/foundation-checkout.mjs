import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const consumerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(
  readFileSync(path.join(consumerRoot, '.ai-dev-foundation', 'foundation-pin.json'), 'utf8'),
);

export const foundationPinnedSha = pin.sha;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  process.exit();
}

/**
 * Resolve FOUNDATION_CHECKOUT and verify it is actually checked out at the
 * pinned SHA before any tool reads from it. A stale or wrong local checkout
 * would otherwise silently produce misleading sync/check/drift results.
 */
export function resolveFoundationCheckout() {
  const foundationRoot = path.resolve(process.env.FOUNDATION_CHECKOUT ?? '../ai-dev-foundation');

  if (!existsSync(foundationRoot)) {
    fail(
      `Foundation checkout not found at ${foundationRoot}.\n` +
        'Set FOUNDATION_CHECKOUT to a local ai-dev-foundation checkout pinned to the ' +
        `SHA recorded in .ai-dev-foundation/foundation-pin.json (${foundationPinnedSha}).`,
    );
  }

  const result = spawnSync('git', ['-C', foundationRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  });
  const actualSha = result.stdout.trim();
  if (result.status !== 0 || !actualSha) {
    fail(`Could not determine the git revision of the Foundation checkout at ${foundationRoot}.`);
  }
  if (actualSha !== foundationPinnedSha) {
    fail(
      `Foundation checkout at ${foundationRoot} is at ${actualSha}, but the pinned SHA in ` +
        `.ai-dev-foundation/foundation-pin.json is ${foundationPinnedSha}.\n` +
        'Re-confirm the pin against the bootstrap Issue before trusting this checkout.',
    );
  }

  return foundationRoot;
}
