import { CalendarSkeleton } from "../_components/CalendarSkeleton";
import { PageHeading } from "@stage-tracker/ui";

/** Keeps the catalog heading and calendar geometry in place while its data resolves. */
export default function CatalogLoading() {
  return (
    <div className="flex flex-col gap-section">
      <PageHeading>イベント</PageHeading>
      <CalendarSkeleton
        sectionLabel="イベントカレンダー"
        fallbackLabel="カレンダーを読み込み中"
      />
    </div>
  );
}
