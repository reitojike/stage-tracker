import { CalendarSkeleton } from "../_components/CalendarSkeleton";

/** Keeps the catalog heading and calendar geometry in place while its data resolves. */
export default function CatalogLoading() {
  return (
    <>
      <h1 className="text-heading font-semibold text-foreground">
        イベントカタログ
      </h1>
      <CalendarSkeleton
        sectionLabel="イベントカレンダー"
        fallbackLabel="カレンダーを読み込み中"
      />
    </>
  );
}
