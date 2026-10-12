import { SourceParseFailure } from "./acquisition";
import {
  assertAllowedSourceUrl,
  type OfficialSourceDefinition,
} from "./source-registry";
import type { RunFailureClassification } from "./shadow-execution";

export interface TerminalFailureClue {
  readonly phase: "acquisition" | "planning" | "publication";
  readonly reason:
    | Exclude<RunFailureClassification, "source_parse">
    | "unsupported_format"
    | "request_limit";
  readonly url: string | null;
}

const KABUKI =
  /^https:\/\/www\.kabuki-bito\.jp\/(schedule\/|theaters\/[a-z-]{1,64}\/play\/[0-9]{1,10}\/?)$/;
const SHOCHIKU =
  /^https:\/\/www1\.ticket-web-shochiku\.com\/t\/info\/(schedule|sale_schedule_east|sale_schedule_west)\.html$/;
const TAKARAZUKA =
  /^https:\/\/kageki\.hankyu\.co\.jp\/(sp\/)?revue\/(index\.html|[0-9]{4}\/[a-z0-9_-]{1,80}\/(index|schedule_takarazuka|schedule_tokyo|ticket_takarazuka|ticket_tokyo)\.html)$/;

export function safeFailureUrl(
  source: OfficialSourceDefinition,
  value: unknown,
): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(assertAllowedSourceUrl(source, value));
    if (url.username !== "" || url.password !== "") return null;
    url.search = "";
    url.hash = "";
    const canonical = url.toString();
    switch (source.id) {
      case "event.kabuki-bito.schedule":
        return KABUKI.test(canonical) ? canonical : null;
      case "ticket.shochiku.schedule":
        return KABUKI.test(canonical) || SHOCHIKU.test(canonical)
          ? canonical
          : null;
      case "event.takarazuka.revue":
        return TAKARAZUKA.test(canonical) ? canonical : null;
      case "ticket.takarazuka.revue-general-sale":
        return canonical.startsWith("https://kageki.hankyu.co.jp/sp/revue/") &&
          TAKARAZUKA.test(canonical)
          ? canonical
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function createTerminalFailureClue(
  source: OfficialSourceDefinition,
  error: unknown,
  classification: RunFailureClassification,
  phase: TerminalFailureClue["phase"],
  draftUrl: string | null,
): TerminalFailureClue | undefined {
  try {
    return {
      phase,
      reason:
        classification === "source_parse"
          ? error instanceof SourceParseFailure
            ? error.reason
            : "unsupported_format"
          : classification,
      url:
        phase === "publication"
          ? null
          : safeFailureUrl(
              source,
              error instanceof SourceParseFailure
                ? error.canonicalUrl
                : draftUrl,
            ),
    };
  } catch {
    return undefined;
  }
}
