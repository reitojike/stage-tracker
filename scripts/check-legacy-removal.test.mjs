import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findLegacyOperationalResidue } from './check-legacy-removal.mjs';

test('legacy app directory and operational references are rejected', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stage-tracker-legacy-check-'));
  mkdirSync(path.join(root, 'apps', 'legacy-web'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      scripts: {
        dev: `pnpm --filter ${['@stage-tracker', 'legacy-web'].join('/')} dev`,
      },
    }),
  );

  const findings = findLegacyOperationalResidue(root);
  assert.ok(findings.some((finding) => finding.includes('directory still exists')));
  assert.ok(findings.some((finding) => finding.includes('legacy package reference')));
});

test('current app-only structure passes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stage-tracker-legacy-check-'));
  mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'pnpm dev' } }));

  assert.deepEqual(findLegacyOperationalResidue(root), []);
});

test('current executable and E2E surfaces reject legacy authority references', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stage-tracker-legacy-check-'));
  const sourceDirectory = path.join(root, 'apps', 'web', 'src');
  const e2eDirectory = path.join(root, 'apps', 'web', 'e2e');
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(e2eDirectory, { recursive: true });
  writeFileSync(
    path.join(sourceDirectory, 'authority.ts'),
    `export const authority = '${['apps', 'legacy-web', 'test', 'auth'].join('/')}';`,
  );
  writeFileSync(
    path.join(e2eDirectory, 'journey.spec.ts'),
    `import '${['@stage-tracker', 'legacy-web'].join('/')}';`,
  );

  const findings = findLegacyOperationalResidue(root);
  assert.ok(findings.some((finding) => finding.includes(path.join('apps', 'web', 'src'))));
  assert.ok(findings.some((finding) => finding.includes(path.join('apps', 'web', 'e2e'))));
});

test('active app and package config reject legacy authority references', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stage-tracker-legacy-check-'));
  const appDirectory = path.join(root, 'apps', 'web');
  const uiDirectory = path.join(root, 'packages', 'ui');
  mkdirSync(appDirectory, { recursive: true });
  mkdirSync(uiDirectory, { recursive: true });
  writeFileSync(
    path.join(appDirectory, '.prettierignore'),
    ['apps', 'legacy-web', 'generated.ts'].join('/'),
  );
  writeFileSync(
    path.join(uiDirectory, 'eslint.config.mjs'),
    `export const formerAuthority = '${['apps', 'legacy-web', 'eslint.config.mjs'].join('/')}';`,
  );

  const findings = findLegacyOperationalResidue(root);
  assert.ok(
    findings.some((finding) => finding.includes(path.join('apps', 'web', '.prettierignore'))),
  );
  assert.ok(
    findings.some((finding) => finding.includes(path.join('packages', 'ui', 'eslint.config.mjs'))),
  );
});

test('active config rejects Windows-style legacy path references', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stage-tracker-legacy-check-'));
  const appDirectory = path.join(root, 'apps', 'web');
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(
    path.join(appDirectory, '.prettierignore'),
    ['apps', 'legacy-web', 'generated.ts'].join('\\'),
  );

  assert.ok(
    findLegacyOperationalResidue(root).some((finding) =>
      finding.includes(path.join('apps', 'web', '.prettierignore')),
    ),
  );
});
