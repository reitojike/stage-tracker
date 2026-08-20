import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeRedirectPath } from '../redirectSafety.ts';

void test('safeRedirectPath keeps a same-origin absolute path', () => {
  assert.equal(safeRedirectPath('/'), '/');
  assert.equal(safeRedirectPath('/events'), '/events');
  assert.equal(safeRedirectPath('/events?day=2026-08-21'), '/events?day=2026-08-21');
});

void test('safeRedirectPath falls back when no target is given', () => {
  assert.equal(safeRedirectPath(null), '/');
  assert.equal(safeRedirectPath(''), '/');
});

void test('safeRedirectPath rejects absolute and scheme-relative URLs', () => {
  assert.equal(safeRedirectPath('https://evil.example'), '/');
  assert.equal(safeRedirectPath('//evil.example'), '/');
  assert.equal(safeRedirectPath('http://evil.example/path'), '/');
});

void test('safeRedirectPath rejects backslash variants of a scheme-relative URL', () => {
  assert.equal(safeRedirectPath('/\\evil.example'), '/');
  assert.equal(safeRedirectPath('\\\\evil.example'), '/');
  assert.equal(safeRedirectPath('/\\/evil.example'), '/');
});

void test('safeRedirectPath rejects a relative path that could escape the origin', () => {
  assert.equal(safeRedirectPath('evil.example'), '/');
  assert.equal(safeRedirectPath('../admin'), '/');
});
