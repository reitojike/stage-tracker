import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';

// Public signup is disabled (supabase/config.toml [auth] enable_signup =
// false) because the event catalog is shared with every authenticated
// user and has no invite gate of its own. This is the admin-provisioning
// path that replaces self-service signup: it only creates the account.
// Signing in afterwards always goes through the normal magic-link flow at
// /sign-in - accounts here have no password.

const email = process.argv[2];
if (typeof email !== 'string' || email.length === 0) {
  console.error('Usage: node scripts/provision-user.mjs <email>');
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

const { data, error } = await admin.auth.admin.createUser({
  email,
  email_confirm: true,
});

if (error) {
  console.error(`Failed to provision ${email}: ${error.message}`);
  process.exitCode = 1;
  process.exit();
}

console.log(`Provisioned ${email} (user id: ${data.user.id}).`);
console.log('They can now sign in at /sign-in with a magic link.');
