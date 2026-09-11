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
import type {
  TicketsTimelineRow,
  TicketsTimelineState,
} from "../_lib/tickets-loader";
import { TicketOpportunityStateControls } from "./TicketOpportunityStateControls";

export interface TicketsViewProps {
  readonly state: OptionalPartBlockState<TicketsTimelineState>;
}

/**
 * `/tickets`'s presentational layer (`docs/v2/oracle-routes-ui.md` §2
 * 「チケット一覧」). Takes the already-classified state as a prop. The
 * shared read boundary supplies the canonical effective-cancellation result,
 * while the component only applies the Oracle presentation priority.
 *
 * `state.optional` (PR #381 P4 follow-up review finding 2) is the personal
 * planning-state read's own status, kept separate from `state.block`'s data:
 * when it failed, every row's badge renders as "不明" rather than silently
 * omitting the badge (which would be indistinguishable from every row
 * genuinely having no personal state - the exact silent-empty failure mode
 * this fix closes), and a small inline note says so next to the still-
 * rendered shared timeline.
 *
 * Planning-state controls (`TicketOpportunityStateControls`, the oracle's
 * "planning state 変更" per-row buttons) are now rendered too (M8 で確定した
 * v2 の不具合の修正 - この write UI 自体が過去のタスクで意図的に scope 外に
 * されていた）. Rendered once per Opportunity via
 * `row.isFirstRowForOpportunity`, and only when the personal-state read
 * itself succeeded (`!personalStateUnknown`) - offering a state toggle while
 * the caller's actual current state is unknown could silently overwrite it
 * incorrectly.
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
 * Badge priority (oracle §2 「チケット一覧」): effective cancellation
 * (中止) is the objective terminal fact and outranks retained post-final
 * history (受付終了), personal-state degradation (不明), and planned/applied
 * badges. At most 1 badge is ever shown, matching "1つだけ表示".
 */
function badgeForRow(row: TicketsTimelineRow, personalStateUnknown: boolean) {
  if (row.isEffectivelyCanceled) {
    return <Badge variant="terminal">中止</Badge>;
  }
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
  readonly row: TicketsTimelineRow;
  readonly personalStateUnknown: boolean;
}) {
  return (
    <div className="flex flex-col gap-xs rounded-control border border-border bg-card p-md">
      <Link
        href={`/catalog/events/${row.eventId}`}
        className="flex flex-col gap-2xs hover:opacity-80"
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
      {/* Opportunity につき1回だけ（`isFirstRowForOpportunity`）。ボタンを
          `<Link>`(=<a>) の子にすると invalid HTML かつクリックがリンクの
          遷移と衝突するため、兄弟要素として置く。personalStateUnknown の
          場合は現在の状態が分からないまま操作させない（M8 で確定した v2 の
          不具合の修正）。post-final（受付終了確定後）行はコントロール自体を
          非表示にする（`docs/v2/oracle-routes-ui.md`「チケット一覧」;
          review finding: 受付終了後に planning state を変更・解除できて
          しまっていた）。 */}
      {row.isFirstRowForOpportunity &&
      !personalStateUnknown &&
      !row.isPostFinalRetainedHistory ? (
        <TicketOpportunityStateControls
          opportunityId={row.opportunityId}
          initialState={row.myState}
        />
      ) : null}
    </div>
  );
}
