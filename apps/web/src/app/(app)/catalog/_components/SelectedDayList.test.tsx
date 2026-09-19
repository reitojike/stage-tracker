import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  eventIdSchema,
  eventSchema,
  genreIdSchema,
  groupIdSchema,
  instantSchema,
  occurrenceSchema,
  tokyoCalendarDateSchema,
  userIdSchema,
  type EventClassification,
  type GroupId,
} from "@stage-tracker/domain";
import type { EventCatalogEntry } from "@/lib/data";
import type { SelectedDayOccurrence } from "../_lib/calendar-view-model";
import { SelectedDayList } from "./SelectedDayList";

const MONTH = { year: 2026, month: 3 };
const DATE = tokyoCalendarDateSchema.parse("2026-03-10");

function event(
  overrides: Partial<{
    id: string;
    title: string;
    startsOn: string;
    endsOn: string;
    venue: string | null;
    canceledAt: string | null;
  }> = {},
) {
  const {
    title = "テスト公演",
    startsOn = DATE,
    endsOn = DATE,
    venue = null,
    canceledAt = null,
  } = overrides;
  const eventLabel = overrides.id ?? "22222222-2222-4222-8222-222222222222";
  return eventSchema.parse({
    id: eventIdSchema.parse(
      eventLabel.includes("fallback")
        ? "33333333-3333-4333-8333-333333333333"
        : "22222222-2222-4222-8222-222222222222",
    ),
    ownerId: userIdSchema.parse("11111111-1111-4111-8111-111111111111"),
    title,
    venue,
    sourceUrl: null,
    memo: null,
    startsOn: tokyoCalendarDateSchema.parse(startsOn),
    endsOn: tokyoCalendarDateSchema.parse(endsOn),
    canceledAt: canceledAt === null ? null : instantSchema.parse(canceledAt),
    createdAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    updatedAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
  });
}

function occurrence(
  overrides: Partial<{
    id: string;
    startsAt: string;
    canceledAt: string | null;
  }> = {},
) {
  const { startsAt = "2026-03-10T01:00:00.000Z", canceledAt = null } =
    overrides;
  return occurrenceSchema.parse({
    id: eventIdSchema.parse("44444444-4444-4444-8444-444444444444"),
    eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
    doorsAt: null,
    startsAt: instantSchema.parse(startsAt),
    endsAt: null,
    canceledAt: canceledAt === null ? null : instantSchema.parse(canceledAt),
    createdAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
    updatedAt: instantSchema.parse("2026-01-01T00:00:00.000Z"),
  });
}

describe("SelectedDayList", () => {
  it("renders the empty state when there are no occurrences and no fallback events", () => {
    render(
      <SelectedDayList
        date={DATE}
        month={MONTH}
        occurrences={[]}
        fallbackEntries={[]}
        classificationByEventId={new Map()}
        groupNameById={new Map()}
      />,
    );
    expect(
      screen.getByText("この日に登録されている公演回はありません"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "3月10日(火)の公演回一覧" }),
    ).toBeInTheDocument();
  });

  it("renders an occurrence's time, title, venue, genre badge, and group badge", () => {
    const occurrences: readonly SelectedDayOccurrence[] = [
      {
        event: event({ title: "花組公演", venue: "東京宝塚劇場" }),
        occurrence: occurrence(),
      },
    ];
    const classificationByEventId = new Map<string, EventClassification>([
      [
        "22222222-2222-4222-8222-222222222222",
        {
          eventId: eventIdSchema.parse("22222222-2222-4222-8222-222222222222"),
          genre: {
            id: genreIdSchema.parse("11111111-1111-4111-8111-111111111111"),
            key: "takarazuka",
            displayName: "宝塚",
            sortOrder: 1,
          },
          groupIds: [
            groupIdSchema.parse("55555555-5555-4555-8555-555555555555"),
          ],
        },
      ],
    ]);
    const groupNameById = new Map<GroupId, string>([
      [groupIdSchema.parse("55555555-5555-4555-8555-555555555555"), "花組"],
    ]);

    render(
      <SelectedDayList
        date={DATE}
        month={MONTH}
        occurrences={occurrences}
        fallbackEntries={[]}
        classificationByEventId={classificationByEventId}
        groupNameById={groupNameById}
      />,
    );

    expect(screen.getByText("花組公演")).toBeInTheDocument();
    expect(screen.getByText("東京宝塚劇場")).toBeInTheDocument();
    expect(screen.getByText("宝塚")).toBeInTheDocument();
    expect(screen.getByText("花組")).toBeInTheDocument();
  });

  it("shows a 中止 badge for an effectively-canceled occurrence", () => {
    const occurrences: readonly SelectedDayOccurrence[] = [
      {
        event: event({ title: "中止公演" }),
        occurrence: occurrence({ canceledAt: "2026-02-01T00:00:00.000Z" }),
      },
    ];
    render(
      <SelectedDayList
        date={DATE}
        month={MONTH}
        occurrences={occurrences}
        fallbackEntries={[]}
        classificationByEventId={new Map()}
        groupNameById={new Map()}
      />,
    );
    expect(screen.getByText("中止")).toBeInTheDocument();
  });

  it("renders a range-only fallback Event in its own section, separate from the occurrence list", () => {
    const fallbackEntry: EventCatalogEntry = {
      event: event({
        id: "fallback-1",
        title: "公演回未発表イベント",
        startsOn: "2026-03-01",
        endsOn: "2026-03-20",
      }),
      occurrences: [],
      classification: {
        eventId: eventIdSchema.parse("33333333-3333-4333-8333-333333333333"),
        genre: null,
        groupIds: [],
      },
    };

    render(
      <SelectedDayList
        date={DATE}
        month={MONTH}
        occurrences={[]}
        fallbackEntries={[fallbackEntry]}
        classificationByEventId={new Map()}
        groupNameById={new Map()}
      />,
    );

    expect(
      screen.getByRole("region", { name: "開催期間で該当するイベント" }),
    ).toBeInTheDocument();
    expect(screen.getByText("公演回未発表イベント")).toBeInTheDocument();
    expect(screen.getByText("3月1日(日) 〜 3月20日(金)")).toBeInTheDocument();
    // The occurrence section still shows its own empty state, independent
    // of the fallback section rendering something.
    expect(
      screen.getByText("この日に登録されている公演回はありません"),
    ).toBeInTheDocument();
  });

  it("formats a single-day fallback Event with its venue", () => {
    const fallbackEntry: EventCatalogEntry = {
      event: event({
        id: "fallback-single-day",
        title: "会場ありイベント",
        startsOn: DATE,
        endsOn: DATE,
        venue: "東京会場",
      }),
      occurrences: [],
      classification: {
        eventId: eventIdSchema.parse("33333333-3333-4333-8333-333333333334"),
        genre: null,
        groupIds: [],
      },
    };

    render(
      <SelectedDayList
        date={DATE}
        month={MONTH}
        occurrences={[]}
        fallbackEntries={[fallbackEntry]}
        classificationByEventId={new Map()}
        groupNameById={new Map()}
      />,
    );

    expect(screen.getByText("3月10日(火) ・ 東京会場")).toBeInTheDocument();
  });
});
