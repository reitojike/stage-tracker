import type { ReactNode } from "react";
import Link from "next/link";
import { instantToTokyoCalendarDate } from "@stage-tracker/domain";
import { Badge, StatePanel } from "@stage-tracker/ui";
import {
  formatMilestoneTypeJa,
  formatMilestoneWhenJa,
} from "@/app/_lib/ticket-milestone-format";
import { formatTokyoCalendarDateJa, formatTokyoTime } from "@/app/_lib/format";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type MergedListBlockState,
  type OptionalPartBlockState,
  type PartState,
} from "@/app/_lib/read-state";
import type {
  HomeTicketDeadlineRow,
  HomeUpcomingItem,
} from "../_lib/home-loader";

export interface HomeViewProps {
  readonly ticketState: OptionalPartBlockState<
    readonly HomeTicketDeadlineRow[]
  >;
  readonly scheduleState: MergedListBlockState<readonly HomeUpcomingItem[]>;
}

/**
 * `/` home's presentational layer (`docs/v2/oracle-routes-ui.md` §2
 * 「ホーム」). Takes both blocks' already-classified state as props - this
 * component makes no `empty`/RLS judgment of its own, it only chooses which
 * `StatePanel` variant/copy to show for a variant it is handed
 * (`docs/v2/decisions.md` "M6 が負う責任" - that judgment belongs to
 * `../_lib/home-loader.ts`, already made before this component ever runs).
 *
 * The 2 blocks are rendered independently (`docs/v2/decisions.md` P4): a
 * failure in one never prevents the other from rendering its own state. The
 * *only* place the 2 blocks' states are compared against each other is the
 * "both empty -> 1 merged empty panel" rule below - `unavailable`/`error` is
 * deliberately never folded into that merge (oracle §2: "unavailable はこの
 * 統合に絶対に含めない"). `ticketState.block`/`scheduleState` are compared
 * for that merge, never `ticketState.optional`/`scheduleState`'s `a`/`b`
 * parts - a failed non-backbone read must never turn a genuinely-populated
 * block into part of the "both empty" merge (PR #381 P4 follow-up review
 * finding).
 *
 * P4 applies *within* each block too (PR #381 P4 follow-up review finding):
 * `ticketState.optional` and `scheduleState`'s `"partial"` variant each
 * carry a non-backbone read's own failure status, kept visible next to
 * whatever data the surviving read(s) produced, instead of that failure
 * silently collapsing into the same "no data"/"0 rows" shape a caller would
 * see with no failure at all.
 */
export function HomeView({ ticketState, scheduleState }: HomeViewProps) {
  const bothEmpty =
    ticketState.block.variant === "empty" && scheduleState.variant === "empty";

  return (
    <div className="flex flex-col gap-section">
      <h1 className="text-heading font-semibold text-foreground">ホーム</h1>

      {bothEmpty ? (
        <StatePanel
          variant="empty"
          title="期限が近い申し込みも、直近の予定もありません"
        />
      ) : (
        <>
          <TicketDeadlineSection state={ticketState} />
          <UpcomingScheduleSection state={scheduleState} />
        </>
      )}
    </div>
  );
}

/**
 * Compact, non-blocking inline note for a single failed non-backbone read
 * (PR #381 P4 follow-up review finding). Deliberately not a `StatePanel` -
 * `StatePanel` replaces a block's *entire* content, but this renders
 * alongside a sibling read's real data, so it needs to stay small. Mirrors
 * `StatePanel`'s own `role="alert"` rule (only for `error`, never
 * `unavailable`) for the same reason: a raw fetch failure is more actionable
 * ("retry") than a permission denial.
 */
function PartFailureNote({
  variant,
  children,
}: {
  readonly variant: "unavailable" | "error";
  readonly children: ReactNode;
}) {
  return (
    <p
      role={variant === "error" ? "alert" : undefined}
      className="text-body-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

function badgeForTicketDeadlineRow(
  row: HomeTicketDeadlineRow["row"],
  personalStateUnknown: boolean,
) {
  if (personalStateUnknown) {
    return <Badge variant="outline">不明</Badge>;
  }
  if (row.myState === "planned") {
    return <Badge variant="subtle">申し込む予定</Badge>;
  }
  if (row.myState === "applied") {
    return <Badge variant="done">申し込み済み</Badge>;
  }
  return null;
}

function TicketDeadlineSection({
  state,
}: {
  readonly state: OptionalPartBlockState<readonly HomeTicketDeadlineRow[]>;
}) {
  const { block, optional } = state;

  return (
    <section
      aria-labelledby="home-ticket-deadlines-heading"
      className="flex flex-col gap-sm"
    >
      <div className="flex items-baseline justify-between">
        <h2
          id="home-ticket-deadlines-heading"
          className="text-title font-semibold text-foreground"
        >
          申し込み期限
        </h2>
        <Link href="/tickets" className="text-body-sm text-primary">
          すべて見る›
        </Link>
      </div>

      {block.variant === "populated" ? (
        <>
          {optional.ok === false ? (
            <PartFailureNote variant={optional.variant}>
              {optional.variant === "unavailable"
                ? "申し込み状態を確認できません"
                : "申し込み状態を取得できませんでした"}
            </PartFailureNote>
          ) : null}
          <ul className="flex flex-col gap-sm">
            {block.data.map(({ row }) => (
              <li key={`${row.opportunityId}-${row.milestone.id}`}>
                <Link
                  href={`/catalog/events/${row.eventId}`}
                  className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
                >
                  <span className="flex items-center gap-xs text-body-sm text-muted-foreground">
                    {formatMilestoneTypeJa(row.milestone.milestoneType)}
                    {badgeForTicketDeadlineRow(row, optional.ok === false)}
                  </span>
                  <span className="text-title font-medium text-foreground">
                    {formatMilestoneWhenJa(row.milestone)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <StatePanel
          variant={block.variant}
          title={
            block.variant === "empty"
              ? "近日中の申し込み期限はありません"
              : block.variant === "unavailable"
                ? "申し込み期限を確認できません"
                : "申し込み期限を読み込めませんでした"
          }
          {...(block.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      )}
    </section>
  );
}

function UpcomingSchedulePartialNotes({
  participations,
  schedule,
}: {
  readonly participations: PartState;
  readonly schedule: PartState;
}) {
  return (
    <>
      {participations.ok === false ? (
        <PartFailureNote variant={participations.variant}>
          {participations.variant === "unavailable"
            ? "参加予定を確認できません"
            : "参加予定を読み込めませんでした"}
        </PartFailureNote>
      ) : null}
      {schedule.ok === false ? (
        <PartFailureNote variant={schedule.variant}>
          {schedule.variant === "unavailable"
            ? "個人の予定を確認できません"
            : "個人の予定を読み込めませんでした"}
        </PartFailureNote>
      ) : null}
    </>
  );
}

function UpcomingScheduleSection({
  state,
}: {
  readonly state: MergedListBlockState<readonly HomeUpcomingItem[]>;
}) {
  return (
    <section
      aria-labelledby="home-upcoming-schedule-heading"
      className="flex flex-col gap-sm"
    >
      <h2
        id="home-upcoming-schedule-heading"
        className="text-title font-semibold text-foreground"
      >
        直近の予定
      </h2>

      {state.variant === "populated" || state.variant === "partial" ? (
        <>
          {state.variant === "partial" ? (
            <UpcomingSchedulePartialNotes
              participations={state.a}
              schedule={state.b}
            />
          ) : null}
          {state.data.length > 0 ? (
            <ul className="flex flex-col gap-sm">
              {state.data.map((item) => (
                <li
                  key={
                    item.kind === "occurrence"
                      ? item.participation.id
                      : item.entry.id
                  }
                >
                  <UpcomingScheduleRow item={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <StatePanel
          variant={state.variant}
          title={
            state.variant === "empty"
              ? "直近の予定はありません"
              : state.variant === "unavailable"
                ? "予定を確認できません"
                : "予定を読み込めませんでした"
          }
          {...(state.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      )}
    </section>
  );
}

function UpcomingScheduleRow({ item }: { readonly item: HomeUpcomingItem }) {
  if (item.kind === "occurrence") {
    return (
      <Link
        href={`/catalog/events/${item.event.id}?occurrence=${item.occurrence.id}`}
        className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
      >
        <span className="text-body-sm text-muted-foreground">
          {formatTokyoCalendarDateJa(
            instantToTokyoCalendarDate(item.occurrence.startsAt),
          )}{" "}
          {formatTokyoTime(item.occurrence.startsAt)}
        </span>
        <span className="text-title font-medium text-foreground">
          {item.event.title}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={`/schedule/${item.entry.id}`}
      className="flex flex-col gap-2xs rounded-control border border-border bg-card p-md hover:bg-muted"
    >
      <span className="text-title font-medium text-foreground">
        {item.entry.title}
      </span>
    </Link>
  );
}
