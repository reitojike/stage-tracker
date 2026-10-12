import { isRenderableHttpUrl } from "@stage-tracker/domain";
import {
  AnchorButton,
  Badge,
  LinkButton,
  PageHeading,
  StatePanel,
} from "@stage-tracker/ui";
import {
  READ_FAILURE_RETRY_HINT_JA,
  type OptionalPartBlockState,
} from "@/app/_lib/read-state";
import {
  ticketPersonalStateBadgeDisplay,
  ticketTargetScopeLabel,
} from "@/app/_lib/ticket-display";
import {
  formatMilestoneTypeJa,
  formatMilestoneWhenJa,
} from "@/app/_lib/ticket-milestone-format";
import type { SelectedTicket } from "../_lib/selected-ticket";
import { TicketOpportunityStateControls } from "./TicketOpportunityStateControls";

export function SelectedTicketView({
  state,
}: {
  readonly state: OptionalPartBlockState<SelectedTicket | null>;
}) {
  const { block, optional } = state;
  const selected = block.variant === "populated" ? block.data : null;
  const opportunity = selected?.detail.opportunityWithTargets.opportunity;
  const personalStateUnknown = !optional.ok;
  const ownBadge =
    selected === null
      ? null
      : ticketPersonalStateBadgeDisplay(selected.myState, personalStateUnknown);
  const sourceUrl =
    opportunity?.sourceUrl && isRenderableHttpUrl(opportunity.sourceUrl)
      ? opportunity.sourceUrl
      : null;

  return (
    <div className="flex flex-col gap-lg">
      <PageHeading>チケット受付</PageHeading>
      {selected !== null && opportunity !== undefined ? (
        <section aria-label="選択した受付" className="flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <h2 className="text-heading font-semibold break-words">
              {opportunity.displayName}
            </h2>
            <p className="text-body break-words">
              {selected.detail.eventTitle}
            </p>
            {selected.detail.eventVenue !== null ? (
              <p className="text-body-sm text-muted-foreground">
                {selected.detail.eventVenue}
              </p>
            ) : null}
            <p className="text-body-sm text-muted-foreground">
              {ticketTargetScopeLabel(
                opportunity.targetScope,
                selected.detail.targetOccurrences,
              )}
            </p>
            {selected.detail.isEffectivelyCanceled ? (
              <Badge variant="terminal" className="w-fit">
                中止
              </Badge>
            ) : null}
          </div>
          {sourceUrl !== null ? (
            <div className="flex flex-col items-start gap-xs">
              <AnchorButton
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                公式情報を開く
              </AnchorButton>
              <p className="text-caption text-muted-foreground break-words">
                公式サイト：{new URL(sourceUrl).hostname}
              </p>
            </div>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              公式情報のリンクはありません
            </p>
          )}
          {selected.detail.milestones.length > 0 ? (
            <dl className="flex flex-col gap-sm">
              {selected.detail.milestones.map((milestone) => (
                <div
                  key={milestone.id}
                  className="flex flex-wrap gap-x-md gap-y-2xs"
                >
                  <dt className="text-body-sm text-muted-foreground">
                    {formatMilestoneTypeJa(milestone.milestoneType)}
                  </dt>
                  <dd className="text-body-sm font-medium flex flex-wrap items-center gap-xs">
                    {formatMilestoneWhenJa(milestone)}
                    {!selected.detail.isEffectivelyCanceled &&
                    selected.pastMilestoneIds.includes(milestone.id) ? (
                      <Badge variant="terminal">
                        {milestone.milestoneType === "application_close"
                          ? "受付終了"
                          : "過去"}
                      </Badge>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-body-sm text-muted-foreground">
              受付の日程情報はありません
            </p>
          )}
          <div className="flex flex-col items-start gap-sm">
            {ownBadge !== null ? (
              <Badge variant={ownBadge.variant}>
                {personalStateUnknown ? "自分の申込状態：不明" : ownBadge.label}
              </Badge>
            ) : (
              <p className="text-body-sm text-muted-foreground">自分：未登録</p>
            )}
            {personalStateUnknown ? (
              <p role="alert" className="text-body-sm text-muted-foreground">
                申し込み状態を確認できません。{READ_FAILURE_RETRY_HINT_JA}
              </p>
            ) : selected.canChangeState ? (
              <TicketOpportunityStateControls
                key={opportunity.id}
                opportunityId={opportunity.id}
                initialState={selected.myState}
              />
            ) : null}
          </div>
          <LinkButton
            href={`/catalog/events/${opportunity.eventId}`}
            variant="outline"
          >
            公演情報
          </LinkButton>
        </section>
      ) : (
        <StatePanel
          variant={
            block.variant === "empty"
              ? "unavailable"
              : block.variant === "populated"
                ? "unavailable"
                : block.variant
          }
          title={
            block.variant === "empty"
              ? "受付が見つかりません"
              : "チケット受付を読み込めませんでした"
          }
          {...(block.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      )}
      <LinkButton href="/tickets" variant="link">
        受付一覧
      </LinkButton>
    </div>
  );
}
