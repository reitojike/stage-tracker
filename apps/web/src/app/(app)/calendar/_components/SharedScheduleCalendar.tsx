"use client";
import { buildMonthGridDays } from "@/app/_lib/calendar-grid";
import { CalendarView, type CalendarViewProps } from "./CalendarView";
import { useSharedScheduleRead } from "../../schedule/_components/useSharedScheduleRead";
import { SharedReadNotice } from "../../schedule/_components/SharedReadNotice";
import { projectSharedCalendar } from "../../schedule/_lib/shared-schedule-projection";

export function SharedScheduleCalendar(props: CalendarViewProps) {
  const { host, state, retry } = useSharedScheduleRead(
    { kind: "list" },
    props.userId,
    JSON.stringify([props.month, props.selectedDate]),
  );
  const days = buildMonthGridDays(props.month);
  const start = days[0];
  const end = days[days.length - 1];
  const entries =
    state.status === "ready" && state.data.kind === "list"
      ? state.data.entries
      : [];
  const scheduleState =
    start && end
      ? projectSharedCalendar(props.scheduleState, entries, start, end)
      : props.scheduleState;
  return (
    <div ref={host} className="flex flex-col gap-sm">
      <SharedReadNotice status={state.status} retry={retry} />
      {state.status !== "identity-changed" && (
        <CalendarView
          {...props}
          scheduleState={scheduleState}
          isSharedScheduleUnknown={state.status !== "ready"}
        />
      )}
    </div>
  );
}
