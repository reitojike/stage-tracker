/** Remove only values carried by the current app's sensitive URL surfaces. */
export function redactObservabilityUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.pathname === "/auth/confirm") {
    // This is a redirect-only route, but never report its token_hash if visited.
    return null;
  }

  if (url.pathname === "/sign-in" || url.pathname === "/notifications") {
    // Sign-in has only fixed UI-state queries; notification cursors encode IDs.
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  if (
    /^\/catalog\/events\/(?!new\/?$)[^/]+\/?(?:edit\/?)?$/.test(url.pathname)
  ) {
    url.pathname = url.pathname.replace(
      /^\/catalog\/events\/[^/]+/,
      "/catalog/events/[eventId]",
    );
    // The occurrence query contains a private entity ID.
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  if (/^\/schedule\/(?!new\/?$)[^/]+\/?(?:edit\/?)?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(
      /^\/schedule\/[^/]+/,
      "/schedule/[entryId]",
    );
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  return rawUrl;
}
