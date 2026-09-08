import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, StatePanel } from "@stage-tracker/ui";
import {
  formatMilestoneTypeJa,
  formatMilestoneWhenJa,
} from "@/app/_lib/ticket-milestone-format";
import { formatMonthJa } from "@/app/_lib/format";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type OptionalPartBlockState,
} from "@/app/_lib/read-state";
import type { TicketOpportunityTimelineRow } from "@stage-tracker/domain";
import type { TicketsTimelineState } from "../_lib/tickets-loader";

export interface TicketsViewProps {
  readonly state: OptionalPartBlockState<TicketsTimelineState>;
}

/**
 * `/tickets`'s presentational layer (`docs/v2/oracle-routes-ui.md` §2
 * 「チケット一覧」). Takes the already-classified state as a prop - see
 * `../_lib/tickets-loader.ts`'s own header for the known gap in the badge
 * priority (①中止 cannot be computed from the data this Task's frozen
 * `apps/web/src/lib/data/` read boundary provides for TicketOpportunity, so
 * `badgeForRow` below starts at tier ②).
 *
 * `state.optional` (PR #381 P4 follow-up review finding 2) is the personal
 * planning-state read's own status, kept separate from `state.block`'s data:
 * when it failed, every row's badge renders as "不明" rather than silently
 * omitting the badge (which would be indistinguishable from every row
 * genuinely having no personal state - the exact silent-empty failure mode
 * this fix closes), and a small inline note says so next to the still-
 * rendered shared timeline.
 *
 * No planning-state controls are rendered (the oracle's "planning state
 *変更" per-row buttons) - this Task's instructions are explicit that write
 * operations are out of scope ("書き込み操作は実装しないこと"), and those
 * controls exist only to trigger `updateTicketOpportunityStateAction`, a
 * Server Action this Task does not implement. The current planning state is
 * still shown, as a badge, since that is read-only display.
 */
export function TicketsView({ state }: TicketsViewProps) {
  const { block, optional } = state;

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">チケット</h1>

      {block.variant !== "populated" ? (
        <StatePanel
          variant={block.variant}
          title={
            block.variant === "empty"
              ? "現在表示できる抽選・販売スケジュールはありません"
              : block.variant === "unavailable"
                ? "チケット情報を確認できません"
                : "チケット情報を読み込めませんでした"
          }
          {...(block.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      ) : (
        <div className="flex flex-col gap-lg">
          {optional.ok === false ? (
            <PersonalStateFailureNote variant={optional.variant} />
          ) : null}
          {block.data.groups.map((group) => (
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
                    <TicketTimelineRow
                      row={row}
                      personalStateUnknown={optional.ok === false}
                    />
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
 * Compact, non-blocking inline note for the personal planning-state read
 * failing while the shared timeline still renders (PR #381 P4 follow-up
 * review finding). Not a `StatePanel` - this renders alongside the still-
 * displayed shared timeline rather than replacing it.
 */
function PersonalStateFailureNote({
  variant,
}: {
  readonly variant: "unavailable" | "error";
}): ReactNode {
  return (
    <p
      role={variant === "error" ? "alert" : undefined}
      className="text-body-sm text-muted-foreground"
    >
      {variant === "unavailable"
        ? "申し込み状態を確認できません"
        : "申し込み状態を取得できませんでした"}
    </p>
  );
}

/**
 * Badge priority (oracle §2 「チケット一覧」, tiers ②-⑤ only - see this
 * component's own header for why tier ① 中止 is not implemented): 受付終了
 * (post-final retained history) takes priority over the personal planning
 * state - that fact comes from the milestone/opportunity data itself, not
 * from the personal-state read, so it is shown even when
 * `personalStateUnknown` is true. Below that, an unknown personal-state read
 * takes priority over any (necessarily null/fallback-derived) `myState`
 * value, which itself prioritizes 申し込み済み over 申し込む予定. At most 1
 * badge is ever shown, matching "1つだけ表示".
 */
function badgeForRow(
  row: TicketOpportunityTimelineRow,
  personalStateUnknown: boolean,
) {
  if (row.isPostFinalRetainedHistory) {
    return <Badge variant="terminal">受付終了</Badge>;
  }
  if (personalStateUnknown) {
    return <Badge variant="outline">不明</Badge>;
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
  personalStateUnknown,
}: {
  readonly row: TicketOpportunityTimelineRow;
  readonly personalStateUnknown: boolean;
}) {
  return (
    <Link
      href={`/catalog/events/${row.eventId}`}
      className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
    >
      <span className="flex items-center gap-xs text-body-sm text-muted-foreground">
        {formatMilestoneTypeJa(row.milestone.milestoneType)}
        {badgeForRow(row, personalStateUnknown)}
      </span>
      <span className="text-title font-medium text-foreground">
        {formatMilestoneWhenJa(row.milestone)}
      </span>
      {/* 販売機会名。同日に複数の同種 milestone があると、種別と日時だけでは
          どの Event / 販売機会の行か判別できない（PR #381 review）。 */}
      <span className="text-body-sm text-muted-foreground">
        {row.displayName}
      </span>
    </Link>
  );
}
