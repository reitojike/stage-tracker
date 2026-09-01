import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPreviewOrigin, resolvePreviewOrigin } from '../previewOrigin.ts';

void test('Preview origin uses the trusted Vercel deployment host', () => {
  assert.equal(
    resolvePreviewOrigin('preview', 'stage-tracker-git-feature-reitojike.vercel.app'),
    'https://stage-tracker-git-feature-reitojike.vercel.app',
  );
});

void test('production does not receive an explicit redirect target', () => {
  assert.equal(resolvePreviewOrigin('production', 'stage-tracker.vercel.app'), undefined);
});

void test('local or non-Vercel environments do not receive an explicit redirect target', () => {
  assert.equal(resolvePreviewOrigin(undefined, 'localhost'), undefined);
  assert.equal(resolvePreviewOrigin('development', 'localhost'), undefined);
});

void test('a missing VERCEL_URL does not receive an explicit redirect target', () => {
  assert.equal(resolvePreviewOrigin('preview', undefined), undefined);
  assert.equal(resolvePreviewOrigin('preview', ''), undefined);
});

void test('the resolver accepts only a host and does not construct from request input', () => {
  assert.equal(resolvePreviewOrigin('preview', 'https://attacker.example'), undefined);
  assert.equal(resolvePreviewOrigin('preview', 'trusted.example/path'), undefined);
  assert.equal(resolvePreviewOrigin('preview', 'trusted.example'), 'https://trusted.example');
});

void test('readPreviewOrigin reads the Vercel system environment at runtime', () => {
  const previousEnv = process.env.VERCEL_ENV;
  const previousUrl = process.env.VERCEL_URL;
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_URL = 'stage-tracker-git-feature-reitojike.vercel.app';

  try {
    assert.equal(readPreviewOrigin(), 'https://stage-tracker-git-feature-reitojike.vercel.app');
  } finally {
    if (previousEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = previousEnv;
    }
    if (previousUrl === undefined) {
      delete process.env.VERCEL_URL;
    } else {
      process.env.VERCEL_URL = previousUrl;
    }
  }
});
