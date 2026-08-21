import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';

// Grants (or revokes) designated catalog creator membership for an
// existing account - the operational half of Issue #29's MVP Event catalog
// write boundary.
//
// This exists so that no user identity is ever written into a migration or
// into application code: membership lives in public.catalog_creators as
// data, and only the service key can change it (authenticated has no
// write grant on that table at all). Which account is the designated
// creator is therefore an operational fact about a given environment, not
// a fact about this repository.
//
// Mirrors scripts/provision-user.mjs: an admin-only path against a running
// local Supabase, resolving the address to a user id rather than taking a
// UUID on the command line.

const [, , email, mode = 'grant'] = process.argv;

if (typeof email !== 'string' || email.length === 0 || (mode !== 'grant' && mode !== 'revoke')) {
  console.error('Usage: node scripts/grant-catalog-creator.mjs <email> [grant|revoke]');
  process.exitCode = 1;
  process.exit();
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

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// listUsers is paginated; walk it rather than assuming the address is on
// the first page, so this does not silently report "no such account" for a
// real account in an environment with many users.
async function findUserByEmail(target) {
  const normalized = target.trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw new Error(`failed to list users: ${error.message}`);
    }
    const match = data.users.find((user) => user.email?.toLowerCase() === normalized);
    if (match) {
      return match;
    }
    if (data.users.length === 0) {
      return null;
    }
  }
}

const user = await findUserByEmail(email);
if (user === null) {
  console.error(
    `No account found for ${email}. Provision it first: node scripts/provision-user.mjs ${email}`,
  );
  process.exitCode = 1;
  process.exit();
}

if (mode === 'revoke') {
  const { error } = await admin.from('catalog_creators').delete().eq('user_id', user.id);
  if (error) {
    console.error(`Failed to revoke catalog creator for ${email}: ${error.message}`);
    process.exitCode = 1;
    process.exit();
  }
  console.log(`Revoked designated catalog creator from ${email} (user id: ${user.id}).`);
} else {
  // upsert, not insert: re-running this for an existing creator is a
  // no-op rather than a duplicate-key failure.
  const { error } = await admin
    .from('catalog_creators')
    .upsert({ user_id: user.id }, { onConflict: 'user_id' });
  if (error) {
    console.error(`Failed to grant catalog creator to ${email}: ${error.message}`);
    process.exitCode = 1;
    process.exit();
  }
  console.log(`Granted designated catalog creator to ${email} (user id: ${user.id}).`);
}
