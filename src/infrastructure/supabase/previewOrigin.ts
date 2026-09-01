/**
 * Resolves the current Vercel Preview origin from Next.js framework
 * environment metadata. This intentionally accepts a host only: a path,
 * query, fragment, or scheme would turn this small resolver into an
 * arbitrary URL construction boundary.
 */
export function resolvePreviewOrigin(
  vercelEnv: string | undefined,
  branchUrl: string | undefined,
  deploymentUrl: string | undefined,
): string | undefined {
  if (vercelEnv !== 'preview') {
    return undefined;
  }

  // Prefer the stable Git branch URL for operator journeys. If it is not
  // available, use the generated deployment URL. Both values are supplied by
  // Vercel's Next.js framework contract and arrive without a scheme.
  const host = [branchUrl, deploymentUrl].find((candidate) => {
    if (typeof candidate !== 'string') {
      return false;
    }

    const value = candidate.trim();
    return (
      value.length > 0 &&
      value.length <= 253 &&
      /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(
        value,
      )
    );
  });

  if (typeof host !== 'string') {
    return undefined;
  }

  // Keep the origin slash because Supabase's documented Vercel wildcard
  // (`https://*-<account-slug>.vercel.app/**`) matches the callback path
  // appended to this redirect target.
  return `https://${host.trim()}/`;
}

/**
 * Reads only Vercel's Next.js framework environment values. The project
 * production URL is deliberately not read: it must never become a Preview
 * redirect target. Production and local environments intentionally return no
 * explicit redirect target so Supabase keeps using its configured Site URL
 * fallback.
 */
export function readPreviewOrigin(): string | undefined {
  return resolvePreviewOrigin(
    process.env.NEXT_PUBLIC_VERCEL_ENV,
    process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL,
  );
}
