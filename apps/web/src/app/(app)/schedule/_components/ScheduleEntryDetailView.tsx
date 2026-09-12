import type { PersonalScheduleEntry } from "@stage-tracker/domain";
import { personalScheduleEntryBlockingForViewer } from "@stage-tracker/domain";
import { Badge, LinkButton } from "@stage-tracker/ui";
import { formatScheduleEntryTemporal } from "./formatScheduleEntryTemporal";
import { scheduleBlockingLabel } from "@/app/_lib/format";

interface ScheduleEntryDetailViewProps {
  readonly entry: PersonalScheduleEntry;
  readonly isOwner: boolean;
  readonly editHref?: string;
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
  isOwner,
  editHref,
}: ScheduleEntryDetailViewProps) {
  const blocking = personalScheduleEntryBlockingForViewer(entry);

  return (
    <div className="flex flex-col gap-sm">
      <header className="flex flex-col gap-xs">
        <div className="flex flex-wrap gap-2xs">
          <Badge variant="subtle">
            {isOwner ? "自分の予定" : "共有されている予定"}
          </Badge>
          <span data-testid="blocking-indicator">
            <Badge variant={blocking ? "subtle" : "outline"}>
              {scheduleBlockingLabel(blocking)}
            </Badge>
          </span>
        </div>
        <div className="flex items-start justify-between gap-sm border-b-2 border-foreground pb-card-block">
          <h1 className="min-w-0 break-words text-heading font-semibold leading-heading text-foreground">
            {entry.title}
          </h1>
          {editHref ? (
            <LinkButton href={editHref} variant="ghost" size="sm">
              編集
            </LinkButton>
          ) : null}
        </div>
      </header>
      <dl className="flex flex-col gap-sm">
        <div className="flex flex-col gap-2xs">
          <dt className="text-caption text-muted-foreground">期間</dt>
          <dd className="text-body text-foreground">
            {formatScheduleEntryTemporal(entry.temporal, {
              includeYear: true,
            })}
          </dd>
        </div>
        {entry.memo !== null && entry.memo.length > 0 ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-caption text-muted-foreground">メモ</dt>
            <dd className="whitespace-pre-wrap text-body-sm text-foreground">
              {entry.memo}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
