import { resolveAdminTarget } from './lib/adminTarget.mjs';

// Public signup is disabled (supabase/config.toml [auth] enable_signup =
// false) because the event catalog is shared with every authenticated
// user and has no invite gate of its own. This is the admin-provisioning
// path that replaces self-service signup: it only creates the account.
// Signing in afterwards always goes through the normal magic-link flow at
// /sign-in - accounts here have no password.
//
// Local:  node scripts/provision-user.mjs <email>
// Remote: node scripts/provision-user.mjs <email> --remote
//   (requires STAGE_TRACKER_REMOTE_SUPABASE_URL /
//   STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY - see scripts/lib/adminTarget.mjs)

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const email = args.find((arg) => arg !== '--remote');

if (typeof email !== 'string' || email.length === 0) {
  console.error('Usage: node scripts/provision-user.mjs <email> [--remote]');
  process.exitCode = 1;
  process.exit();
}

const admin = resolveAdminTarget(remote);

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
