import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tool = process.argv[2];
if (tool !== 'check' && tool !== 'sync') {
  console.error('Usage: node scripts/run-foundation-tool.mjs <check|sync>');
  process.exitCode = 1;
  process.exit();
}

const foundationRoot = path.resolve(process.env.FOUNDATION_CHECKOUT ?? '../ai-dev-foundation');
const toolingScript = path.join(foundationRoot, 'tooling', `${tool}.mjs`);

if (!existsSync(toolingScript)) {
  console.error(
    `Foundation checkout not found at ${foundationRoot}.\n` +
      'Set FOUNDATION_CHECKOUT to a local ai-dev-foundation checkout pinned to the ' +
      'SHA recorded in .ai-dev-foundation/product-rules.md / the bootstrap Issue.',
  );
  process.exitCode = 1;
  process.exit();
}

const result = spawnSync(process.execPath, [toolingScript, '--consumer', process.cwd()], {
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
