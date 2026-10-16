"use client";
import type { UserId } from "@stage-tracker/domain";
import type { ScreenNow } from "@/app/_lib/now";
import { HomeView, type HomeViewProps } from "./HomeView";
import { useSharedScheduleRead } from "../schedule/_components/useSharedScheduleRead";
import { SharedReadNotice } from "../schedule/_components/SharedReadNotice";
import { projectSharedHome } from "../schedule/_lib/shared-schedule-projection";

export function SharedScheduleHome({
  actorId,
  now,
  ...props
}: HomeViewProps & { readonly actorId: UserId; readonly now: ScreenNow }) {
  const { host, state, retry } = useSharedScheduleRead(
    { kind: "list" },
    actorId,
  );
  const entries =
    state.status === "ready" && state.data.kind === "list"
      ? state.data.entries
      : [];
  return (
    <div ref={host} className="flex flex-col gap-sm">
      <SharedReadNotice status={state.status} retry={retry} />
      {state.status !== "identity-changed" && (
        <HomeView
          {...props}
          scheduleState={projectSharedHome(props.scheduleState, entries, now)}
          isSharedScheduleUnknown={state.status !== "ready"}
        />
      )}
    </div>
  );
}
