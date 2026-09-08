import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { personalScheduleEntryBlockingForViewer } from "@stage-tracker/domain";
import { formatScheduleEntryTemporal } from "./formatScheduleEntryTemporal";

interface ScheduleEntryDetailViewProps {
  readonly entry: PersonalScheduleEntry;
}

/**
 * `/schedule/[entryId]` の entry 本体表示。
 *
 * `blocking` は `personalScheduleEntryBlockingForViewer`
 * （`@stage-tracker/domain`）を経由して読む。この関数は viewer 引数を
 * 一切取らない - それ自体が「per-recipient の blocking override は
 * 存在しない」という product invariant の実装であり
 * （`packages/domain/src/schedule/scheduleShare.ts` の doc comment
 * 参照）、この component 側で `isOwner`/viewer 種別によって `blocking`
 * の値や表示を分岐させることは絶対にしない（このタスクの報告
 * 「blocking の伝播をどう実装・検証したか」参照）。
 */
export function ScheduleEntryDetailView({
  entry,
}: ScheduleEntryDetailViewProps) {
  const blocking = personalScheduleEntryBlockingForViewer(entry);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-body text-foreground">
        {formatScheduleEntryTemporal(entry.temporal)}
      </p>
      {entry.memo ? (
        <p className="text-body-sm text-muted-foreground">{entry.memo}</p>
      ) : null}
      <p
        className="text-body-sm text-muted-foreground"
        data-testid="blocking-indicator"
      >
        {blocking
          ? "この時間は空き時間として扱いません（blocking）。"
          : "この時間も空き時間として扱われます（non-blocking）。"}
      </p>
    </div>
  );
}
