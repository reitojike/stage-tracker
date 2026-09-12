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
      scripts: { dev: `pnpm --filter ${['@stage-tracker', 'legacy-web'].join('/')} dev` },
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
