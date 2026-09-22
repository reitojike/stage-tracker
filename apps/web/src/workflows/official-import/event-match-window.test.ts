import { describe, expect, it } from "vitest";
import {
  EVENT_MATCH_LIMIT,
  EventMatchWindowExceededFailure,
  requireCompleteEventMatchWindow,
} from "./event-match-window";

describe("bounded Event match window", () => {
  it("returns a complete bounded result", () => {
    const rows = Array.from({ length: EVENT_MATCH_LIMIT }, (_, index) => index);
    expect(requireCompleteEventMatchWindow(rows)).toEqual(rows);
  });

  it("fails closed when the extra probe row proves truncation", () => {
    const rows = Array.from(
      { length: EVENT_MATCH_LIMIT + 1 },
      (_, index) => index,
    );
    expect(() => requireCompleteEventMatchWindow(rows)).toThrow(
      EventMatchWindowExceededFailure,
    );
  });
});
