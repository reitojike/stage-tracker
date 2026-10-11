import { SourceParseFailure, type AcquisitionDraft } from "./acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "./source-registry";
import type { RunFailureClassification } from "./shadow-execution";

export interface OfficialImportFailureObservation {
  readonly phase: "acquisition" | "planning" | "publication";
  readonly reasonCode:
    | Exclude<RunFailureClassification, "source_parse">
    | "unsupported_format"
    | "request_limit";
  readonly canonicalUrl: string | null;
  readonly officialExternalId: string | null;
  readonly acquiredDraftCount: number | null;
  readonly validatedCandidateCount: number;
  readonly heldPageCount: number;
}

export function safeObservationUrl(
  source: OfficialSourceDefinition,
  value: string | null,
): string | null {
  if (value === null) return null;
  try {
    const url = new URL(assertAllowedSourceUrl(source, value));
    if (url.username !== "" || url.password !== "") return null;
    url.search = "";
    url.hash = "";
    const canonical = url.toString();
    return canonical.length <= 2048 &&
      /^https:\/\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9/%_.:-]*$/.test(canonical)
      ? canonical
      : null;
  } catch {
    return null;
  }
}

export function createFailureObservation(
  source: OfficialSourceDefinition,
  error: unknown,
  classification: RunFailureClassification,
  phase: OfficialImportFailureObservation["phase"],
  draft: AcquisitionDraft | null,
  acquiredDraftCount: number | null,
  validatedCandidateCount: number,
  heldPageCount: number,
): OfficialImportFailureObservation {
  const id = draft?.officialExternalId;
  return {
    phase,
    reasonCode:
      error instanceof SourceParseFailure
        ? error.reason
        : classification === "source_parse"
          ? "unsupported_format"
          : classification,
    canonicalUrl: safeObservationUrl(
      source,
      phase === "publication"
        ? null
        : error instanceof SourceParseFailure
          ? error.canonicalUrl
          : (draft?.canonicalUrl ?? null),
    ),
    officialExternalId:
      phase !== "publication" &&
      typeof id === "string" &&
      id.length <= 512 &&
      /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(id)
        ? id
        : null,
    acquiredDraftCount,
    validatedCandidateCount,
    heldPageCount,
  };
}
