import { CalendarSkeleton } from "../_components/CalendarSkeleton";

/** Keeps the calendar heading and grid geometry in place during navigation. */
export default function CalendarLoading() {
  return (
    <>
      <h1 className="text-heading font-semibold text-foreground">カレンダー</h1>
      <CalendarSkeleton
        sectionLabel="カレンダー"
        fallbackLabel="カレンダーを読み込み中"
      />
    </>
  );
}
