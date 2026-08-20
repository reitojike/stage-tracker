/**
 * Post-sign-in redirect targets arrive from the magic-link email's query
 * string, so they are attacker influenceable. Only same-origin, single-
 * slash absolute paths are honoured; anything else falls back to '/'.
 */
export function safeRedirectPath(next: string | null): string {
  if (next === null || next.length === 0) {
    return '/';
  }
  // Backslashes are normalised to forward slashes by some user agents, so
  // "/\evil.example" can be read as a scheme-relative URL. Reject both.
  const normalized = next.replaceAll('\\', '/');
  if (!normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }
  return normalized;
}
