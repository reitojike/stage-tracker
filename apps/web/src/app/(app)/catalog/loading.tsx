import { CalendarSkeleton } from "../_components/CalendarSkeleton";

/** Keeps the catalog heading and calendar geometry in place while its data resolves. */
export default function CatalogLoading() {
  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">イベント</h1>
      <CalendarSkeleton
        sectionLabel="イベントカレンダー"
        fallbackLabel="カレンダーを読み込み中"
      />
    </div>
  );
}
