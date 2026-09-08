import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  occurrenceIdSchema,
  participationIdSchema,
  userIdSchema,
  type Event,
  type Occurrence,
  type Participation,
} from "@stage-tracker/domain";
import type { ParticipationWithOccurrence, ReadState } from "@/lib/data";
import { buildParticipationLookup } from "./participationLookup";

const eventId = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const otherEventId = eventIdSchema.parse(
  "99999999-9999-4999-8999-999999999999",
);
const occurrenceId = occurrenceIdSchema.parse(
  "22222222-2222-4222-8222-222222222222",
);
const userId = userIdSchema.parse("33333333-3333-4333-8333-333333333333");

function row(overrides: {
  occurrenceId?: string;
  eventId?: string;
  status?: "attending" | "considering";
}): ParticipationWithOccurrence {
  const rowOccurrenceId = occurrenceIdSchema.parse(
    overrides.occurrenceId ?? occurrenceId,
  );
  const rowEventId = eventIdSchema.parse(overrides.eventId ?? eventId);
  const participation: Participation = {
    id: participationIdSchema.parse("44444444-4444-4444-8444-444444444444"),
    occurrenceId: rowOccurrenceId,
    userId,
    status: overrides.status ?? "attending",
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z" as Participation["createdAt"],
    updatedAt: "2026-01-01T00:00:00.000Z" as Participation["updatedAt"],
  };
  const occurrence = {
    id: rowOccurrenceId,
    eventId: rowEventId,
  } as unknown as Occurrence;
  const event = { id: rowEventId } as unknown as Event;
  return { participation, occurrence, event };
}

describe("buildParticipationLookup", () => {
  it("never collapses an `unavailable` read into an empty lookup", () => {
    const state: ReadState<readonly ParticipationWithOccurrence[]> = {
      variant: "unavailable",
      message: "permission denied",
    };

    const lookup = buildParticipationLookup(state, eventId);

    expect(lookup).toEqual({
      ok: false,
      variant: "unavailable",
      message: "permission denied",
    });
  });

  it("never collapses an `error` read into an empty lookup", () => {
    const state: ReadState<readonly ParticipationWithOccurrence[]> = {
      variant: "error",
      message: "network failure",
    };

    const lookup = buildParticipationLookup(state, eventId);

    expect(lookup).toEqual({
      ok: false,
      variant: "error",
      message: "network failure",
    });
  });

  it("treats a genuine `empty` read as a confirmed-empty lookup, not a failure", () => {
    const state: ReadState<readonly ParticipationWithOccurrence[]> = {
      variant: "empty",
    };

    const lookup = buildParticipationLookup(state, eventId);

    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.byOccurrenceId.size).toBe(0);
    }
  });

  it("indexes populated rows by occurrenceId, scoped to the given eventId only", () => {
    const state: ReadState<readonly ParticipationWithOccurrence[]> = {
      variant: "populated",
      data: [
        row({ status: "attending" }),
        // A participation belonging to a *different* event must not leak
        // into this event's lookup (listMyParticipations is unscoped by
        // event - filtering here is this module's whole job).
        row({
          occurrenceId: "55555555-5555-4555-8555-555555555555",
          eventId: otherEventId,
        }),
      ],
    };

    const lookup = buildParticipationLookup(state, eventId);

    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.byOccurrenceId.size).toBe(1);
      expect(lookup.byOccurrenceId.get(occurrenceId)?.status).toBe("attending");
    }
  });
});
