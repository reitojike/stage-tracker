import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';

// Shared by scripts/provision-user.mjs and scripts/grant-catalog-creator.mjs
// so both admin-only paths resolve a target the same way. Remote is never
// the default: a bare command always hits the local dev stack, and a
// caller must pass --remote *and* export the two env vars below to reach a
// hosted project. Neither var is read from a committed file (see
// .env.local.example) - the operator exports them in their own shell for
// the duration of this one command.
export function resolveAdminTarget(remote) {
  if (remote) {
    const url = process.env.STAGE_TRACKER_REMOTE_SUPABASE_URL;
    const serviceRoleKey = process.env.STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY;
    if (
      typeof url !== 'string' ||
      url.length === 0 ||
      typeof serviceRoleKey !== 'string' ||
      serviceRoleKey.length === 0
    ) {
      console.error(
        '--remote requires STAGE_TRACKER_REMOTE_SUPABASE_URL and ' +
          'STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY to be set in the environment.',
      );
      process.exitCode = 1;
      process.exit();
    }
    console.error(`[remote] target: ${url}`);
    return createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  // Windows can only launch node_modules/.bin's supabase.cmd shim through a
  // shell (Node throws EINVAL otherwise); the args below are static
  // literals, not external input, so shell:true carries no injection risk
  // here.
  const statusResult = spawnSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (statusResult.status !== 0) {
    console.error('Failed to read local Supabase status. Is `supabase start` running?');
    console.error(statusResult.stderr);
    process.exitCode = 1;
    process.exit();
  }
  const status = JSON.parse(statusResult.stdout);
  return createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
