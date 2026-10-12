import type { TicketsTimelineMonthGroup } from "./tickets-loader";

export const TICKETS_VIEWS = [
  "upcoming",
  "planned",
  "applied",
  "past",
] as const;

export type TicketsView = (typeof TICKETS_VIEWS)[number];

export function parseTicketsView(
  value: string | string[] | undefined,
): TicketsView {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return TICKETS_VIEWS.find((view) => view === firstValue) ?? "upcoming";
}

export function filterTicketsTimelineGroups(
  groups: readonly TicketsTimelineMonthGroup[],
  view: TicketsView,
): TicketsTimelineMonthGroup[] {
  return groups.flatMap((group) => {
    const rows = group.rows.filter((row) => {
      switch (view) {
        case "upcoming":
          return !row.isPostFinalRetainedHistory;
        case "planned":
          return !row.isPostFinalRetainedHistory && row.myState === "planned";
        case "applied":
          return !row.isPostFinalRetainedHistory && row.myState === "applied";
        case "past":
          return row.isPostFinalRetainedHistory;
      }
    });

    return rows.length > 0 ? [{ ...group, rows }] : [];
  });
}
