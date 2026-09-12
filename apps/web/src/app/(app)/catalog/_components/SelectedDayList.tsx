import {
  isCanceled,
  isEffectivelyCanceled,
  type EventClassification,
  type GroupId,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import { CompactList, ListRowLink, StatePanel } from "@stage-tracker/ui";
import type { EventCatalogEntry } from "@/lib/data";
import {
  formatTokyoCalendarDateJa,
  formatTokyoCalendarDateRangeJa,
  occurrenceTimeRangeLabel,
} from "@/app/_lib/format";
import type { TokyoYearMonth } from "@/app/_lib/calendar-grid";
import type { SelectedDayOccurrence } from "../_lib/calendar-view-model";
import { catalogEventHref } from "../_lib/catalog-links";
import { ClassificationBadges } from "./ClassificationBadges";

export interface SelectedDayListProps {
  readonly date: TokyoCalendarDate;
  readonly month: TokyoYearMonth;
  /** Every occurrence on `date` (`../_lib/calendar-view-model.ts`'s
   * `selectDayOccurrences`). */
  readonly occurrences: readonly SelectedDayOccurrence[];
  /** Events whose Event range covers `date` but have no actual occurrence
   * on it (`selectEventLevelFallback`) - e.g. a 0-occurrence Event whose
   * range overlaps `date` (AGENTS.md "Catalog の日程参照要件": a 0-occurrence
   * Event within its Event range must still be reachable). */
  readonly fallbackEntries: readonly EventCatalogEntry[];
  readonly classificationByEventId: ReadonlyMap<string, EventClassification>;
  readonly groupNameById: ReadonlyMap<GroupId, string>;
}

/**
 * The full-detail escape hatch for one selected day, ported from the M8
 * oracle (`docs/v2/oracle-domain.md` §2.9). Combined
 * into a single component (rather than 2, like legacy) since both sections are
 * always about the same selected `date` and this Task's scope only calls
 * for "a selected-day list showing that day's events" as one surface.
 *
 * Renders the range-only fallback section first, then every actual
 * occurrence on `date` - the same order `CatalogView.tsx`'s legacy
 * counterpart renders its 2 separate components in. An event never appears
 * in both sections for the same `date` by construction
 * (`selectEventLevelFallback`'s own doc comment: an occurrence on `date`
 * disqualifies the event from the fallback list).
 */
export function SelectedDayList({
  date,
  month,
  occurrences,
  fallbackEntries,
  classificationByEventId,
  groupNameById,
}: SelectedDayListProps) {
  return (
    <>
      {fallbackEntries.length > 0 ? (
        <section
          aria-label="開催期間で該当するイベント"
          className="flex flex-col gap-sm"
        >
          <h2 className="text-title font-semibold text-foreground">
            開催期間で該当するイベント
          </h2>
          <CompactList>
            {fallbackEntries.map((entry) => (
              <li key={entry.event.id}>
                <ListRowLink
                  href={catalogEventHref(entry.event.id, month, date)}
                >
                  <span className="flex flex-col gap-2xs">
                    <span className="text-title font-medium text-foreground">
                      {entry.event.title}
                    </span>
                    <span className="text-body-sm text-muted-foreground">
                      {formatTokyoCalendarDateRangeJa(
                        entry.event.startsOn,
                        entry.event.endsOn,
                      )}
                      {entry.event.venue !== null
                        ? ` ・ ${entry.event.venue}`
                        : ""}
                    </span>
                    <ClassificationBadges
                      classification={entry.classification}
                      groupNameById={groupNameById}
                      canceled={isCanceled(entry.event)}
                    />
                  </span>
                </ListRowLink>
              </li>
            ))}
          </CompactList>
        </section>
      ) : null}

      <section
        aria-label={`${formatTokyoCalendarDateJa(date)}の公演回一覧`}
        className="flex flex-col gap-sm"
      >
        <h2 className="text-title font-semibold text-foreground">
          {formatTokyoCalendarDateJa(date)}
        </h2>
        {occurrences.length === 0 ? (
          <StatePanel
            variant="empty"
            title="この日に登録されている公演回はありません"
          />
        ) : (
          <CompactList>
            {occurrences.map(({ event, occurrence }) => {
              const classification =
                classificationByEventId.get(event.id) ?? null;
              return (
                <li key={occurrence.id}>
                  <ListRowLink
                    href={catalogEventHref(
                      event.id,
                      month,
                      date,
                      occurrence.id,
                    )}
                  >
                    <span className="flex flex-col gap-2xs">
                      <span className="text-body-sm text-muted-foreground">
                        {occurrenceTimeRangeLabel(
                          occurrence.startsAt,
                          occurrence.endsAt,
                        )}
                      </span>
                      <span className="text-title font-medium text-foreground">
                        {event.title}
                      </span>
                      {event.venue !== null ? (
                        <span className="text-body-sm text-muted-foreground">
                          {event.venue}
                        </span>
                      ) : null}
                      <ClassificationBadges
                        classification={classification}
                        groupNameById={groupNameById}
                        canceled={isEffectivelyCanceled(event, occurrence)}
                      />
                    </span>
                  </ListRowLink>
                </li>
              );
            })}
          </CompactList>
        )}
      </section>
    </>
  );
}
