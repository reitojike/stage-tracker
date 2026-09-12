import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_DIRECTORY = ['apps', 'legacy-web'].join(path.sep);
const LEGACY_PACKAGE = ['@stage-tracker', 'legacy-web'].join('/');

const SCAN_TARGETS = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json',
  '.coderabbit.yaml',
  '.github',
  'scripts',
  'test',
  'supabase/config.toml',
  'apps/web/package.json',
  'apps/web/eslint.config.mjs',
  'apps/web/playwright.config.ts',
  'apps/web/tsconfig.json',
  'packages/domain/package.json',
  'packages/ui/package.json',
];

function filesUnder(target) {
  if (!existsSync(target)) return [];
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target, { recursive: true })
    .map((entry) => path.join(target, entry))
    .filter((entry) => statSync(entry).isFile());
}

export function findLegacyOperationalResidue(repositoryRoot = process.cwd()) {
  const findings = [];
  const legacyDirectory = path.join(repositoryRoot, LEGACY_DIRECTORY);
  if (existsSync(legacyDirectory)) {
    findings.push(`${LEGACY_DIRECTORY}: directory still exists`);
  }

  const self = fileURLToPath(import.meta.url);
  for (const relativeTarget of SCAN_TARGETS) {
    const absoluteTarget = path.join(repositoryRoot, relativeTarget);
    for (const file of filesUnder(absoluteTarget)) {
      if (path.resolve(file) === path.resolve(self)) continue;
      const content = readFileSync(file, 'utf8');
      if (content.includes(LEGACY_DIRECTORY.replaceAll(path.sep, '/'))) {
        findings.push(`${path.relative(repositoryRoot, file)}: legacy directory reference`);
      }
      if (content.includes(LEGACY_PACKAGE)) {
        findings.push(`${path.relative(repositoryRoot, file)}: legacy package reference`);
      }
    }
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = findLegacyOperationalResidue();
  if (findings.length > 0) {
    console.error('Legacy operational residue detected:');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  } else {
    console.log('Legacy app directory and operational references are absent.');
  }
}
