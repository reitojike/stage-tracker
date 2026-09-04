import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readLocalSupabaseStatus } from '../test/rls/support/localSupabase.ts';

// Produces the production build that test/auth runs against (Issue #286).
// test:auth boots the app with `next start` instead of `next dev`, so a build
// has to exist before the suite runs - see assertProductionBuildPresent in
// test/auth/support/appServer.ts, which fails fast when it does not.
//
// This is deliberately a *separate* build from `npm run build` (the one
// `Verify / Build` runs), because Next.js resolves NEXT_PUBLIC_* differently
// on the two sides of a production build. Verified against Next.js 16.3.1 by
// building both ways and reading the emitted chunk:
//
// - the server side reads them from the running process's environment, so
//   appServer.ts can supply them when it spawns `next start`;
// - the client side has them substituted *at build time*. Built with the vars
//   set, the chunk contains the literal value
//   (`sk("http://127.0.0.1:54321","NEXT_PUBLIC_SUPABASE_URL")`); built without
//   them, it keeps reading an empty `process.env` shim and
//   createSupabaseBrowserClient() (src/infrastructure/supabase/browserClient.ts,
//   used by the passkey buttons) would throw "Missing required environment
//   variable" in the browser.
//
// `npm run build` intentionally runs with no Supabase credentials at all, so
// reusing its output here would ship that broken browser client into the app
// under test. Building once more with the local stack's own values - read via
// the CLI rather than hard-coded, for the same reason readLocalSupabaseStatus
// itself gives - keeps the artifact honest for both sides.
const status = readLocalSupabaseStatus();

// Invoked through Next's own bin with this process's node, rather than the
// `next` shim, so no extra shell/wrapper process sits between npm and the
// build (same reasoning as spawnNextStart in appServer.ts).
const result = spawnSync(
  process.execPath,
  [path.join('node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
