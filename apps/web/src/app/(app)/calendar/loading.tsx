import { CalendarSkeleton } from "../_components/CalendarSkeleton";
import { PageHeading } from "@stage-tracker/ui";

/** Keeps the calendar heading and grid geometry in place during navigation. */
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-section">
      <PageHeading>カレンダー</PageHeading>
      <CalendarSkeleton
        sectionLabel="カレンダー"
        fallbackLabel="カレンダーを読み込み中"
      />
    </div>
  );
}
