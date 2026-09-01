/**
 * Resolves the current Vercel Preview deployment origin from trusted system
 * environment metadata. This intentionally accepts a host only: a path,
 * query, fragment, or scheme would turn this small resolver into an
 * arbitrary URL construction boundary.
 */
export function resolvePreviewOrigin(
  vercelEnv: string | undefined,
  vercelUrl: string | undefined,
): string | undefined {
  if (vercelEnv !== 'preview' || typeof vercelUrl !== 'string') {
    return undefined;
  }

  const host = vercelUrl.trim();
  // VERCEL_URL is supplied without a scheme and represents a deployment host.
  // Keep the validation bounded to host syntax; do not turn this into a URL
  // routing or allowlist framework.
  if (
    host.length === 0 ||
    host.length > 253 ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(
      host,
    )
  ) {
    return undefined;
  }

  return `https://${host}`;
}

/**
 * Reads only Vercel's system environment values. Production and local
 * environments intentionally return no explicit redirect target so Supabase
 * keeps using its configured Site URL fallback.
 */
export function readPreviewOrigin(): string | undefined {
  return resolvePreviewOrigin(process.env.VERCEL_ENV, process.env.VERCEL_URL);
}
