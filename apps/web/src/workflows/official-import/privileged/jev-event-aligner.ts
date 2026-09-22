import "server-only";
import { createHash } from "node:crypto";
import type {
  CatalogEventMatch,
  EventAlignmentResult,
  EventSemanticAligner,
} from "../event-candidate-planner";

const JEV_ENDPOINT = "https://www.jevai.org/api/v1/decisions";
const JEV_MODEL = "typesafe-ai/jev";
const MIN_CONFIDENCE = 0.85;

type JevFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactCandidate(candidate: CatalogEventMatch) {
  return {
    id: candidate.id,
    hasOfficialSourceIdentity: candidate.sourceKey !== null,
    title: candidate.title,
    venue: candidate.venue,
    startsOn: candidate.startsOn,
    endsOn: candidate.endsOn,
    occurrenceStartsAt: candidate.occurrences.map(
      (occurrence) => occurrence.startsAt,
    ),
    groups: candidate.groups.map((group) => group.displayName),
  };
}

export function createJevEventAligner(
  apiKey: string | undefined,
  fetcher: JevFetch = fetch,
): EventSemanticAligner {
  return {
    async align(draft, candidates): Promise<EventAlignmentResult> {
      if (apiKey === undefined || candidates.length === 0) {
        return { status: "unavailable" };
      }
      const candidateIds = candidates.map((candidate) => candidate.id);
      const state = {
        proposed: {
          title: draft.proposal.title,
          venue: draft.proposal.venue ?? null,
          startsOn: draft.proposal.startsOn,
          endsOn: draft.proposal.endsOn,
          occurrenceStartsAt: draft.proposal.occurrences.map(
            (occurrence) => occurrence.startsAt,
          ),
          groups:
            draft.proposal.groups?.map((group) => group.displayName) ?? [],
        },
        candidates: candidates.map(compactCandidate),
      };
      const criteria: Record<string, string> = {};
      for (const id of candidateIds) {
        criteria[id] = `The proposal is the same Event as candidate ${id}.`;
      }
      criteria.no_match =
        "The proposal is clearly a different Event from every candidate.";
      criteria.ambiguous =
        "The supplied facts do not safely establish one identity.";
      const questions = {
        event_alignment: {
          type: "choice",
          instructions:
            "Choose the candidate id only when the supplied facts clearly refer to the same real-world Event. Choose no_match when clearly distinct, or ambiguous when the facts are insufficient. Never infer missing dates, times, or venues.",
          criteria,
        },
      };
      const request = { model: JEV_MODEL, state, questions };
      const inputFingerprint = createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex");
      let response: Response;
      try {
        response = await fetcher(JEV_ENDPOINT, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        });
      } catch {
        return { status: "unavailable" };
      }
      if (!response.ok) return { status: "unavailable" };
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { status: "unavailable" };
      }
      if (!record(payload) || payload.code !== 0 || !record(payload.data)) {
        return { status: "unavailable" };
      }
      const answers = payload.data.answers;
      if (!record(answers) || !record(answers.event_alignment)) {
        return { status: "unavailable" };
      }
      const answer = answers.event_alignment;
      const choice = answer.choice;
      const confidence = answer.confidence;
      if (typeof choice !== "string" || typeof confidence !== "number") {
        return { status: "unavailable" };
      }
      const evidence = {
        decisionKind: "event_alignment",
        version: "v1",
        provider: "jev",
        model: JEV_MODEL,
        choice,
        confidence,
        referencedCandidateIds: candidateIds,
        inputFingerprint,
      };
      if (confidence < MIN_CONFIDENCE) {
        return { status: "low_confidence", evidence };
      }
      if (choice === "no_match") return { status: "unmatched", evidence };
      if (choice === "ambiguous") return { status: "ambiguous", evidence };
      return candidateIds.includes(choice)
        ? { status: "matched", eventId: choice, confidence, evidence }
        : { status: "low_confidence", evidence };
    },
  };
}
