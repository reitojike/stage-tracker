import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { eventIdSchema, tokyoCalendarDateSchema } from "@stage-tracker/domain";
import { OccurrenceList } from "./OccurrenceList";

vi.mock("./AddOccurrenceForm", () => ({
  AddOccurrenceForm: () => null,
}));
vi.mock("./OccurrenceItem", () => ({
  OccurrenceItem: () => null,
}));

const EVENT_ID = eventIdSchema.parse("11111111-1111-4111-8111-111111111111");
const START_DATE = tokyoCalendarDateSchema.parse("2026-03-10");
const END_DATE = tokyoCalendarDateSchema.parse("2026-03-20");

describe("OccurrenceList", () => {
  it("renders a multi-day Event range with the shared Japanese formatter", () => {
    render(
      <OccurrenceList
        eventId={EVENT_ID}
        eventRange={{ startsOn: START_DATE, endsOn: END_DATE }}
        occurrences={[]}
      />,
    );

    expect(
      screen.getByText("開催期間: 3月10日(火) 〜 3月20日(金)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/2026-03-10|2026-03-20/)).not.toBeInTheDocument();
  });

  it("uses the formatter's single-day range semantics", () => {
    render(
      <OccurrenceList
        eventId={EVENT_ID}
        eventRange={{ startsOn: START_DATE, endsOn: START_DATE }}
        occurrences={[]}
      />,
    );

    expect(screen.getByText("開催期間: 3月10日(火)")).toBeInTheDocument();
  });
});
