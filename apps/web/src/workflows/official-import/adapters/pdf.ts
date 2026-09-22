import { createHash } from "node:crypto";
import { SourceFetchFailure } from "../acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "../source-registry";

const MAX_PDF_BYTES = 15_000_000;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

export interface OfficialPdfDocument {
  readonly url: string;
  readonly body: Uint8Array;
  readonly observedAt: string;
  readonly contentHash: string;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export type OfficialPdfFetcher = (
  source: OfficialSourceDefinition,
  url: string,
) => Promise<OfficialPdfDocument>;

export async function fetchOfficialPdf(
  source: OfficialSourceDefinition,
  candidateUrl: string,
  transport: typeof fetch = fetch,
): Promise<OfficialPdfDocument> {
  let url = assertAllowedSourceUrl(source, candidateUrl);
  let response: Response | null = null;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    try {
      response = await transport(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { Accept: "application/pdf" },
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
  if (response === null || !response.ok) throw new SourceFetchFailure();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/pdf")) {
    throw new SourceFetchFailure();
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    throw new SourceFetchFailure();
  }
  let body: Uint8Array;
  try {
    body = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new SourceFetchFailure();
  }
  if (
    body.byteLength === 0 ||
    body.byteLength > MAX_PDF_BYTES ||
    new TextDecoder().decode(body.slice(0, 5)) !== "%PDF-"
  ) {
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
