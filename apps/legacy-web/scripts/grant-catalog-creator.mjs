import { resolveAdminTarget } from './lib/adminTarget.mjs';
import { findUserByEmail } from './lib/findUserByEmail.mjs';

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
// Mirrors scripts/provision-user.mjs: an admin-only path, resolving the
// address to a user id rather than taking a UUID on the command line.
//
// Local:  node scripts/grant-catalog-creator.mjs <email> [grant|revoke]
// Remote: node scripts/grant-catalog-creator.mjs <email> [grant|revoke] --remote
//   (requires STAGE_TRACKER_REMOTE_SUPABASE_URL /
//   STAGE_TRACKER_REMOTE_SERVICE_ROLE_KEY - see scripts/lib/adminTarget.mjs)

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const positional = args.filter((arg) => arg !== '--remote');
const [email, mode = 'grant'] = positional;

if (typeof email !== 'string' || email.length === 0 || (mode !== 'grant' && mode !== 'revoke')) {
  console.error('Usage: node scripts/grant-catalog-creator.mjs <email> [grant|revoke] [--remote]');
  process.exitCode = 1;
  process.exit();
}

const admin = resolveAdminTarget(remote);

const user = await findUserByEmail(admin, email);
if (user === null) {
  console.error(
    `No account found for ${email}. Provision it first: node scripts/provision-user.mjs ${email}${remote ? ' --remote' : ''}`,
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
