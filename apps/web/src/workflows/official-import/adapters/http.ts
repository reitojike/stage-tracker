import { createHash } from "node:crypto";
import { SourceFetchFailure } from "../acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "../source-registry";

const MAX_HTML_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export interface OfficialHtmlDocument {
  readonly url: string;
  readonly body: string;
  readonly observedAt: string;
  readonly contentHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export type OfficialHtmlFetcher = (
  source: OfficialSourceDefinition,
  url: string,
) => Promise<OfficialHtmlDocument>;

export async function fetchOfficialHtml(
  source: OfficialSourceDefinition,
  candidateUrl: string,
  transport: typeof fetch = fetch,
): Promise<OfficialHtmlDocument> {
  let url = assertAllowedSourceUrl(source, candidateUrl);
  let response: Response | null = null;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    try {
      response = await transport(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      throw new SourceFetchFailure();
    }
    if (response.status < 300 || response.status >= 400) break;
    if (redirects === MAX_REDIRECTS) throw new SourceFetchFailure();
    const location = response.headers.get("location");
    if (location === null) throw new SourceFetchFailure();
    url = assertAllowedSourceUrl(source, new URL(location, url).toString());
  }
  if (response === null) throw new SourceFetchFailure();
  if (!response.ok) throw new SourceFetchFailure();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new SourceFetchFailure();
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
    throw new SourceFetchFailure();
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_HTML_BYTES) {
    throw new SourceFetchFailure();
  }
  return {
    url,
    body,
    observedAt: new Date().toISOString(),
    contentHash: createHash("sha256").update(body).digest("hex"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

export function hashOfficialDocuments(
  documents: readonly OfficialHtmlDocument[],
): string {
  const hash = createHash("sha256");
  for (const document of documents) hash.update(document.contentHash);
  return hash.digest("hex");
}
