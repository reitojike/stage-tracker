import type {
  EventId,
  Occurrence,
  TokyoCalendarDate,
} from "@stage-tracker/domain";
import { formatTokyoCalendarDateRangeJa } from "@/app/_lib/format";
import { AddOccurrenceForm } from "./AddOccurrenceForm";
import { OccurrenceItem } from "./OccurrenceItem";

/**
 * 公演回一覧（`docs/v2/oracle-routes-ui.md` §1「Event と公演回」:
 * event は 0 件の公演回を持てる - Issue #87）。0件は正当な状態であり、
 * 空の一覧をエラー扱いにしない。
 */
export function OccurrenceList({
  eventId,
  eventRange,
  occurrences,
}: {
  eventId: EventId;
  eventRange: { startsOn: TokyoCalendarDate; endsOn: TokyoCalendarDate };
  occurrences: readonly Occurrence[];
}) {
  return (
    <div className="flex flex-col gap-sm border-b-2 border-border pb-lg">
      <h2 className="text-title leading-title font-semibold text-foreground">
        公演回
      </h2>
      <p className="text-body-sm text-muted-foreground">
        開催期間: {formatTokyoCalendarDateRangeJa(eventRange.startsOn, eventRange.endsOn)}
      </p>
      {occurrences.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          公演回はまだ登録されていません。
        </p>
      ) : (
        <div className="flex flex-col">
          {occurrences.map((occurrence) => (
            <OccurrenceItem
              key={occurrence.id}
              eventId={eventId}
              occurrence={occurrence}
            />
          ))}
        </div>
      )}
      <AddOccurrenceForm eventId={eventId} />
    </div>
  );
}
