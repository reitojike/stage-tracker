import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveFoundationCheckout } from './foundation-checkout.mjs';

const tool = process.argv[2];
if (tool !== 'check' && tool !== 'sync') {
  console.error('Usage: node scripts/run-foundation-tool.mjs <check|sync>');
  process.exitCode = 1;
  process.exit();
}

const foundationRoot = resolveFoundationCheckout();
const toolingScript = path.join(foundationRoot, 'tooling', `${tool}.mjs`);

if (!existsSync(toolingScript)) {
  console.error(`Foundation tooling script not found at ${toolingScript}.`);
  process.exitCode = 1;
  process.exit();
}

const result = spawnSync(process.execPath, [toolingScript, '--consumer', process.cwd()], {
  stdio: 'inherit',
});

process.exitCode = result.status ?? 1;
