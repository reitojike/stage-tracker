// Shared by the admin-only operator scripts that take an email address
// rather than a raw user UUID on the command line
// (scripts/grant-catalog-creator.mjs, scripts/import-catalog-events.mjs).
//
// listUsers is paginated; this walks it rather than assuming the address
// is on the first page, so it does not silently report "no such account"
// for a real account in an environment with many users.
export async function findUserByEmail(admin, target) {
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
