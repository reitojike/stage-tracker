function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Post-sign-in redirect targets arrive from the magic-link email's query
 * string, so they are attacker influenceable. Only same-origin, single-
 * slash absolute paths are honoured; anything else falls back to '/'.
 */
export function safeRedirectPath(next: string | null): string {
  if (next === null || next.length === 0) {
    return '/';
  }
  // CR/LF and other control characters must never reach the Location
  // header. The runtime does reject them, but by failing the whole
  // response - so a link carrying "%0D%0A" would consume the user's
  // one-time token and return a 500 instead of signing them in.
  if (hasControlCharacter(next)) {
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
