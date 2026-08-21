import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readPublicSupabaseEnv } from '../env.ts';

function apply(url: string | undefined, anonKey: string | undefined): void {
  // Assigning `undefined` would store the string "undefined", which the
  // validator would happily accept - the variable has to be removed.
  if (url === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  }
  if (anonKey === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  }
}

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  apply(values.NEXT_PUBLIC_SUPABASE_URL, values.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  try {
    run();
  } finally {
    apply(previous.url, previous.anonKey);
  }
}

void test('readPublicSupabaseEnv returns both public values', () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    },
    () => {
      assert.deepEqual(readPublicSupabaseEnv(), {
        url: 'http://127.0.0.1:54321',
        anonKey: 'anon-key',
      });
    },
  );
});

void test('readPublicSupabaseEnv names the variable that is missing', () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' }, () => {
    assert.throws(() => readPublicSupabaseEnv(), /NEXT_PUBLIC_SUPABASE_URL/);
  });

  withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, () => {
    assert.throws(() => readPublicSupabaseEnv(), /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

// Behavioural tests cannot catch this: under Node both lookup styles work,
// and the failure only appears in a browser bundle, where Next.js inlines
// `NEXT_PUBLIC_*` solely for statically analyzable references. Nothing in
// this app is a Client Component yet, so a build check would prove nothing
// either. Guarding the source keeps the regression reviewable without
// standing up bundler machinery for it.
void test('public env vars are read by static property access, not by key', () => {
  const source = readFileSync(fileURLToPath(new URL('../env.ts', import.meta.url)), 'utf8');
  // The comments in that file describe the dynamic form in order to warn
  // against it, so strip them before checking the actual code.
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/[^\n]*/g, '');

  assert.match(code, /process\.env\.NEXT_PUBLIC_SUPABASE_URL\b/);
  assert.match(code, /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY\b/);
  assert.doesNotMatch(
    code,
    /process\.env\[/,
    'dynamic process.env[...] access is not inlined into the browser bundle',
  );
});
