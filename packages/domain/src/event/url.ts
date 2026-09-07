/**
 * Whether `value` is a URL that is safe to render as a clickable link.
 *
 * `Event.sourceUrl` is free text (docs/v2/oracle-domain.md §1.1: "sourceUrl
 * (nullable。http/https のみ表示上リンク化可能 - isRenderableHttpUrl)"), so
 * storage does not require it to already be a valid URL. This predicate is
 * the display-time gate: only `http:`/`https:` URLs are renderable as links
 * (in particular, it excludes `javascript:`/`data:`/other schemes).
 */
export function isRenderableHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
