import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPreviewOrigin, resolvePreviewOrigin } from '../previewOrigin.ts';

void test('Preview origin prefers the trusted Vercel branch host', () => {
  assert.equal(
    resolvePreviewOrigin(
      'preview',
      'stage-tracker-git-feature-reitojike.vercel.app',
      'stage-tracker-abc123-reitojike.vercel.app',
    ),
    'https://stage-tracker-git-feature-reitojike.vercel.app',
  );
});

void test('Preview origin falls back to the generated deployment host', () => {
  assert.equal(
    resolvePreviewOrigin('preview', undefined, 'stage-tracker-abc123-reitojike.vercel.app'),
    'https://stage-tracker-abc123-reitojike.vercel.app',
  );
});

void test('production does not receive an explicit redirect target', () => {
  assert.equal(
    resolvePreviewOrigin(
      'production',
      'stage-tracker-git-feature-reitojike.vercel.app',
      'stage-tracker-abc123-reitojike.vercel.app',
    ),
    undefined,
  );
});

void test('local or non-Vercel environments do not receive an explicit redirect target', () => {
  assert.equal(resolvePreviewOrigin(undefined, 'localhost', undefined), undefined);
  assert.equal(resolvePreviewOrigin('development', 'localhost', undefined), undefined);
});

void test('missing Preview URLs do not receive an explicit redirect target', () => {
  assert.equal(resolvePreviewOrigin('preview', undefined, undefined), undefined);
  assert.equal(resolvePreviewOrigin('preview', '', ''), undefined);
});

void test('the resolver accepts only a host and falls back past malformed branch input', () => {
  assert.equal(
    resolvePreviewOrigin('preview', 'https://attacker.example', 'trusted.example/path'),
    undefined,
  );
  assert.equal(
    resolvePreviewOrigin('preview', 'trusted.example/path', 'trusted.example'),
    'https://trusted.example',
  );
});

void test('readPreviewOrigin reads the Next.js framework environment contract', () => {
  const previous = {
    env: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    deploymentUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
    productionUrl: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  };
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
  process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL = 'stage-tracker-git-feature-reitojike.vercel.app';
  process.env.NEXT_PUBLIC_VERCEL_URL = 'stage-tracker-abc123-reitojike.vercel.app';
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = 'stage-tracker.com';

  try {
    assert.equal(readPreviewOrigin(), 'https://stage-tracker-git-feature-reitojike.vercel.app');
  } finally {
    const names = [
      'NEXT_PUBLIC_VERCEL_ENV',
      'NEXT_PUBLIC_VERCEL_BRANCH_URL',
      'NEXT_PUBLIC_VERCEL_URL',
      'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL',
    ] as const;
    const values = [
      previous.env,
      previous.branchUrl,
      previous.deploymentUrl,
      previous.productionUrl,
    ];
    names.forEach((name, index) => {
      const value = values[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

void test('the project production URL is never used as a Preview origin', () => {
  const previous = {
    env: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    deploymentUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
    productionUrl: process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
  };
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
  delete process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL;
  delete process.env.NEXT_PUBLIC_VERCEL_URL;
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL = 'stage-tracker.com';

  try {
    assert.equal(readPreviewOrigin(), undefined);
  } finally {
    const names = [
      'NEXT_PUBLIC_VERCEL_ENV',
      'NEXT_PUBLIC_VERCEL_BRANCH_URL',
      'NEXT_PUBLIC_VERCEL_URL',
      'NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL',
    ] as const;
    const values = [
      previous.env,
      previous.branchUrl,
      previous.deploymentUrl,
      previous.productionUrl,
    ];
    names.forEach((name, index) => {
      const value = values[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});

void test('legacy raw Vercel variables do not become redirect authority', () => {
  const previous = {
    rawEnv: process.env.VERCEL_ENV,
    rawUrl: process.env.VERCEL_URL,
    env: process.env.NEXT_PUBLIC_VERCEL_ENV,
    branchUrl: process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    deploymentUrl: process.env.NEXT_PUBLIC_VERCEL_URL,
  };
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_URL = 'raw-preview.example';
  delete process.env.NEXT_PUBLIC_VERCEL_ENV;
  delete process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL;
  delete process.env.NEXT_PUBLIC_VERCEL_URL;

  try {
    assert.equal(readPreviewOrigin(), undefined);
  } finally {
    const values = [
      previous.rawEnv,
      previous.rawUrl,
      previous.env,
      previous.branchUrl,
      previous.deploymentUrl,
    ];
    const names = [
      'VERCEL_ENV',
      'VERCEL_URL',
      'NEXT_PUBLIC_VERCEL_ENV',
      'NEXT_PUBLIC_VERCEL_BRANCH_URL',
      'NEXT_PUBLIC_VERCEL_URL',
    ] as const;
    names.forEach((name, index) => {
      const value = values[index];
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  }
});
