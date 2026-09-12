import type { ReactNode } from "react";
import {
  isRenderableHttpUrl,
  type TokyoCalendarDate,
} from "@stage-tracker/domain";
import {
  AnchorButton,
  Badge,
  CompactList,
  ListRow,
  ListRowActions,
  ListRowChevron,
  ListRowOverlayLink,
  StatePanel,
} from "@stage-tracker/ui";
import {
  formatMilestoneTypeJa,
  formatMilestoneWhenJa,
} from "@/app/_lib/ticket-milestone-format";
import { formatMonthJa } from "@/app/_lib/format";
import {
  ticketDeadlineBadgeDisplay,
  ticketPersonalStateBadgeDisplay,
  ticketTargetScopeLabel,
} from "@/app/_lib/ticket-display";
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
  readonly today: TokyoCalendarDate;
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
export function TicketsView({ state, today }: TicketsViewProps) {
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
              <CompactList>
                {group.rows.map((row) => (
                  <li key={`${row.opportunityId}-${row.milestone.id}`}>
                    <TicketTimelineRow
                      row={row}
                      personalStateUnknown={optional.ok === false}
                      today={today}
                    />
                  </li>
                ))}
              </CompactList>
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
  const display = ticketPersonalStateBadgeDisplay(
    row.myState,
    personalStateUnknown,
  );
  return display === null ? null : (
    <Badge variant={display.variant}>{display.label}</Badge>
  );
}

function TicketTimelineRow({
  row,
  personalStateUnknown,
  today,
}: {
  readonly row: TicketsTimelineRow;
  readonly personalStateUnknown: boolean;
  readonly today: TokyoCalendarDate;
}) {
  const deadlineBadge = ticketDeadlineBadgeDisplay(row, today);
  const secondaryLine =
    row.eventVenue === null
      ? row.displayName
      : `${row.eventVenue}・${row.displayName}`;
  return (
    <ListRow>
      <ListRowOverlayLink
        href={`/catalog/events/${row.eventId}`}
        aria-label={`${row.eventTitle}の詳細を見る`}
      />
      <div className="pointer-events-none relative z-0 flex w-[7.25rem] shrink-0 flex-col gap-2xs text-body-sm text-muted-foreground">
        <span>{formatMilestoneTypeJa(row.milestone.milestoneType)}</span>
        <span className="font-medium text-foreground">
          {formatMilestoneWhenJa(row.milestone)}
        </span>
        {deadlineBadge !== null ? (
          <Badge variant={deadlineBadge.variant} className="w-fit">
            {deadlineBadge.label}
          </Badge>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="pointer-events-none relative z-0 flex flex-col gap-2xs">
          {badgeForRow(row, personalStateUnknown)}
          <span className="text-title font-semibold leading-title text-foreground">
            {row.eventTitle}
          </span>
          <span className="text-body-sm text-muted-foreground">
            {secondaryLine}
          </span>
          {row.targetScope === "selected_occurrences" ? (
            <span className="text-caption text-muted-foreground">
              {ticketTargetScopeLabel(row.targetScope, row.targetOccurrences)}
            </span>
          ) : null}
        </div>
        {/* Opportunity につき1回だけ（`isFirstRowForOpportunity`）。ボタンを
          `<Link>`(=<a>) の子にすると invalid HTML かつクリックがリンクの
          遷移と衝突するため、兄弟要素として置く。personalStateUnknown の
          場合は現在の状態が分からないまま操作させない（M8 で確定した v2 の
          不具合の修正）。post-final（受付終了確定後）行はコントロール自体を
          非表示にする（`docs/v2/oracle-routes-ui.md`「チケット一覧」;
          review finding: 受付終了後に planning state を変更・解除できて
          しまっていた）。 */}
        <ListRowActions className="mt-xs">
          {row.sourceUrl !== null && isRenderableHttpUrl(row.sourceUrl) ? (
            <AnchorButton
              href={row.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              variant="link"
              size="xs"
            >
              公式情報
            </AnchorButton>
          ) : null}
          {row.isFirstRowForOpportunity &&
          !personalStateUnknown &&
          !row.isPostFinalRetainedHistory ? (
            <TicketOpportunityStateControls
              opportunityId={row.opportunityId}
              initialState={row.myState}
            />
          ) : null}
        </ListRowActions>
      </div>
      <ListRowChevron />
    </ListRow>
  );
}
