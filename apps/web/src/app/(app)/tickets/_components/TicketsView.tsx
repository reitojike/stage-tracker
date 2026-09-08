import Link from "next/link";
import { Badge, StatePanel } from "@stage-tracker/ui";
import {
  formatMilestoneTypeJa,
  formatMilestoneWhenJa,
} from "@/app/_lib/ticket-milestone-format";
import { formatMonthJa } from "@/app/_lib/format";
import type { BlockState } from "@/app/_lib/read-state";
import type { TicketOpportunityTimelineRow } from "@stage-tracker/domain";
import type { TicketsTimelineState } from "../_lib/tickets-loader";

export interface TicketsViewProps {
  readonly state: BlockState<TicketsTimelineState>;
}

/**
 * `/tickets`'s presentational layer (`docs/v2/oracle-routes-ui.md` §2
 * 「チケット一覧」). Takes the already-classified `BlockState` as a prop -
 * see `../_lib/tickets-loader.ts`'s own header for the known gap in the
 * badge priority (①中止 cannot be computed from the data this Task's frozen
 * `apps/web/src/lib/data/` read boundary provides for TicketOpportunity, so
 * `badgeForRow` below starts at tier ②).
 *
 * No planning-state controls are rendered (the oracle's "planning state
 *変更" per-row buttons) - this Task's instructions are explicit that write
 * operations are out of scope ("書き込み操作は実装しないこと"), and those
 * controls exist only to trigger `updateTicketOpportunityStateAction`, a
 * Server Action this Task does not implement. The current planning state is
 * still shown, as a badge, since that is read-only display.
 */
export function TicketsView({ state }: TicketsViewProps) {
  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">チケット</h1>

      {state.variant !== "populated" ? (
        <StatePanel
          variant={state.variant}
          title={
            state.variant === "empty"
              ? "現在表示できる抽選・販売スケジュールはありません"
              : state.variant === "unavailable"
                ? "チケット情報を確認できません"
                : "チケット情報を読み込めませんでした"
          }
          description={state.variant === "empty" ? "" : state.message}
        />
      ) : (
        <div className="flex flex-col gap-lg">
          {state.data.groups.map((group) => (
            <section
              key={group.monthKey}
              aria-label={formatMonthJa(group.monthKey)}
              className="flex flex-col gap-sm"
            >
              <h2 className="text-title font-semibold text-foreground">
                {formatMonthJa(group.monthKey)}
              </h2>
              <ul className="flex flex-col gap-sm">
                {group.rows.map((row) => (
                  <li key={`${row.opportunityId}-${row.milestone.id}`}>
                    <TicketTimelineRow row={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Badge priority (oracle §2 「チケット一覧」, tiers ②-⑤ only - see this
 * component's own header for why tier ① 中止 is not implemented): 受付終了
 * (post-final retained history) takes priority over the personal planning
 * state, which itself prioritizes 申し込み済み over 申し込む予定. At most 1
 * badge is ever shown, matching "1つだけ表示".
 */
function badgeForRow(row: TicketOpportunityTimelineRow) {
  if (row.isPostFinalRetainedHistory) {
    return <Badge variant="terminal">受付終了</Badge>;
  }
  if (row.myState === "applied") {
    return <Badge variant="done">申し込み済み</Badge>;
  }
  if (row.myState === "planned") {
    return <Badge variant="subtle">申し込む予定</Badge>;
  }
  return null;
}

function TicketTimelineRow({
  row,
}: {
  readonly row: TicketOpportunityTimelineRow;
}) {
  return (
    <Link
      href={`/catalog/events/${row.eventId}`}
      className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
    >
      <span className="flex items-center gap-xs text-body-sm text-muted-foreground">
        {formatMilestoneTypeJa(row.milestone.milestoneType)}
        {badgeForRow(row)}
      </span>
      <span className="text-title font-medium text-foreground">
        {formatMilestoneWhenJa(row.milestone)}
      </span>
    </Link>
  );
}
