import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const template = readFileSync(
  new URL('../../../../supabase/templates/magic_link.html', import.meta.url),
  'utf8',
);

void test('Magic Link template keeps RedirectTo and SiteURL fallback semantics', () => {
  assert.match(template, /{{ if and \.RedirectTo \(ne \.RedirectTo \.SiteURL\) }}/);
  assert.match(template, /{{ \.RedirectTo }}auth\/confirm\?token_hash={{ \.TokenHash }}/);
  assert.doesNotMatch(template, /{{ \.RedirectTo }}\/auth\/confirm/);
  assert.match(template, /{{ else }}/);
  assert.match(template, /{{ \.SiteURL }}\/auth\/confirm\?token_hash={{ \.TokenHash }}/);
  assert.match(template, /{{ end }}/);
  assert.match(template, /\/auth\/confirm\?token_hash=/);
  assert.match(template, /type=email/);
  assert.match(template, /next=\//);
});
