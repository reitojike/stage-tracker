import {
  canInviteToOccurrence,
  compareInstants,
  eventIdSchema,
  isCanceled,
  isEffectivelyCanceled,
  isRenderableHttpUrl,
  userIdSchema,
} from "@stage-tracker/domain";
import {
  AnchorButton,
  BackLink,
  Badge,
  LinkButton,
  StatePanel,
} from "@stage-tracker/ui";
import { classifyListReadResult, listMyParticipations } from "@/lib/data";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEventWithOccurrences } from "./_data/getEventDetail";
import { InviteForm } from "./_components/InviteForm";
import { ParticipationControls } from "./_components/ParticipationControls";
import { ScrollToFocusedOccurrence } from "./_components/ScrollToFocusedOccurrence";
import {
  buildCatalogBackHref,
  buildCatalogEditHref,
  type CatalogSearchParams,
} from "./_lib/backHref";
import {
  formatOccurrenceDateTime,
  formatOccurrenceDoors,
  formatOccurrenceEnds,
} from "./_lib/formatOccurrence";
import { buildParticipationLookup } from "./_lib/participationLookup";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<CatalogSearchParams>;
}

const CONTENT_CLASS = "flex w-full flex-col gap-md";

/**
 * `/catalog/events/[eventId]`（`docs/v2/oracle-routes-ui.md` §1/§2
 * イベント詳細）。occurrence 一覧・participation 状態の表示と、
 * participation の書き込み・invite の起点となる Server Component。
 *
 * 認証チェックはここでも行う（`docs/v2/oracle-routes-ui.md` §0 の
 * 「各page.tsx側の認証チェックはこの一次防御(`src/proxy.ts`)の上に乗る
 * 二次チェック」）。`src/proxy.ts` の default-deny により実際にはここへ
 * 未認証で到達しない想定だが、真の書き込み権限境界は常に RLS/RPC 側にある
 * という位置づけ（`docs/v2/decisions.md`「引き継ぐと決めた不変原則」）。
 */
export default async function EventDetailPage({
  params,
  searchParams,
}: EventDetailPageProps) {
  const { eventId: rawEventId } = await params;
  const search = await searchParams;
  const backHref = buildCatalogBackHref(search);

  const parsedEventId = eventIdSchema.safeParse(rawEventId);
  if (!parsedEventId.success) {
    return (
      <div className={CONTENT_CLASS}>
        <BackLink href={backHref}>一覧へ戻る</BackLink>
        <StatePanel
          variant="empty"
          title="指定されたイベントが見つかりません"
        />
      </div>
    );
  }
  const eventId = parsedEventId.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null) {
    return (
      <div className={CONTENT_CLASS}>
        <BackLink href={backHref}>一覧へ戻る</BackLink>
        <StatePanel variant="unavailable" title="サインインが必要です" />
      </div>
    );
  }
  const userId = userIdSchema.parse(user.id);

  const [eventReadResult, participationsReadResult] = await Promise.all([
    getEventWithOccurrences(supabase, eventId),
    listMyParticipations(supabase, userId),
  ]);

  const eventState = classifyListReadResult(eventReadResult);

  if (eventState.variant !== "populated") {
    return (
      <div className={CONTENT_CLASS}>
        <BackLink href={backHref}>一覧へ戻る</BackLink>
        <StatePanel
          variant={eventState.variant}
          title={
            eventState.variant === "empty"
              ? "指定されたイベントが見つかりません"
              : eventState.variant === "unavailable"
                ? "イベントを確認できません"
                : "イベントを読み込めませんでした"
          }
          {...(eventState.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      </div>
    );
  }

  const eventDetail = eventState.data[0];
  if (eventDetail === undefined) {
    // Unreachable: `populated` implies `data.length > 0` (classifyListReadResult
    // never returns `populated` with an empty array), but
    // `noUncheckedIndexedAccess` requires this to be narrowed explicitly.
    return (
      <div className={CONTENT_CLASS}>
        <BackLink href={backHref}>一覧へ戻る</BackLink>
        <StatePanel
          variant="empty"
          title="指定されたイベントが見つかりません"
        />
      </div>
    );
  }

  // AGENTS.md「イベント詳細画面」: participation の個別読込失敗は event 本体
  // とは別枠で表示する（event は表示継続）。「read ごとに独立して劣化」
  // (docs/v2/decisions.md P4)。
  const participationState = classifyListReadResult(participationsReadResult);
  const participationLookup = buildParticipationLookup(
    participationState,
    eventId,
  );

  const focusOccurrenceId =
    typeof search.occurrence === "string" ? search.occurrence : null;
  const occurrences = [...eventDetail.occurrences].sort((a, b) =>
    compareInstants(a.startsAt, b.startsAt),
  );

  return (
    <div className={CONTENT_CLASS}>
      <ScrollToFocusedOccurrence occurrenceId={focusOccurrenceId} />
      <BackLink href={backHref}>一覧へ戻る</BackLink>

      <header className="flex flex-wrap items-center justify-between gap-sm border-b-2 border-foreground pb-card-block">
        <div className="flex min-w-0 items-center gap-sm">
          <h1 className="min-w-0 break-words text-heading font-semibold leading-heading text-foreground">
            {eventDetail.event.title}
          </h1>
          {isCanceled(eventDetail.event) ? (
            <Badge variant="terminal">中止</Badge>
          ) : null}
        </div>
        {eventDetail.event.ownerId === user.id ? (
          <LinkButton
            href={buildCatalogEditHref(eventId, search)}
            variant="ghost"
            size="sm"
          >
            編集
          </LinkButton>
        ) : null}
      </header>

      <dl className="flex flex-col gap-xs">
        {eventDetail.event.venue !== null ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-caption text-muted-foreground">会場</dt>
            <dd className="text-body-sm text-foreground">
              {eventDetail.event.venue}
            </dd>
          </div>
        ) : null}
        {eventDetail.event.sourceUrl !== null ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-caption text-muted-foreground">参照URL</dt>
            <dd className="min-w-0 text-body-sm [overflow-wrap:anywhere]">
              {isRenderableHttpUrl(eventDetail.event.sourceUrl) ? (
                <AnchorButton
                  href={eventDetail.event.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full justify-start px-0 whitespace-normal break-all"
                >
                  {eventDetail.event.sourceUrl}
                </AnchorButton>
              ) : (
                eventDetail.event.sourceUrl
              )}
            </dd>
          </div>
        ) : null}
        {eventDetail.event.memo !== null &&
        eventDetail.event.memo.length > 0 ? (
          <div className="flex flex-col gap-2xs">
            <dt className="text-caption text-muted-foreground">メモ</dt>
            <dd className="whitespace-pre-wrap text-body-sm text-foreground">
              {eventDetail.event.memo}
            </dd>
          </div>
        ) : null}
      </dl>

      {!participationLookup.ok ? (
        <StatePanel
          variant={participationLookup.variant}
          title={
            participationLookup.variant === "unavailable"
              ? "参加状況を確認できません"
              : "参加状況を読み込めませんでした"
          }
          {...(participationLookup.variant === "error"
            ? { description: READ_FAILURE_RETRY_HINT_JA }
            : {})}
        />
      ) : null}

      <section
        aria-labelledby="event-occurrences-heading"
        className="flex flex-col gap-sm"
      >
        <h2
          id="event-occurrences-heading"
          className="flex items-baseline justify-between border-b-2 border-foreground pb-card-block text-title font-semibold text-foreground"
        >
          公演回{" "}
          <span className="font-normal text-muted-foreground">
            {occurrences.length}件
          </span>
        </h2>
        {occurrences.length === 0 ? (
          <StatePanel
            variant="empty"
            title="公演回はまだ登録されていません"
            description="開催期間は決まっていますが、具体的な公演回はまだ発表されていません。"
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {occurrences.map((occurrence) => {
              const myParticipation = participationLookup.ok
                ? (participationLookup.byOccurrenceId.get(occurrence.id) ??
                  null)
                : null;
              const occurrenceCanceled = isEffectivelyCanceled(
                eventDetail.event,
                occurrence,
              );
              const doors = formatOccurrenceDoors(occurrence);
              const ends = formatOccurrenceEnds(occurrence);
              const canInvite = !participationLookup.ok
                ? false
                : canInviteToOccurrence(myParticipation?.status ?? null) &&
                  !occurrenceCanceled;

              return (
                <li
                  key={occurrence.id}
                  id={`occurrence-${occurrence.id}`}
                  className={
                    focusOccurrenceId === occurrence.id
                      ? "flex flex-col gap-xs rounded-control-sm px-sm py-compact ring-1 ring-inset ring-primary"
                      : "flex flex-col gap-xs py-compact"
                  }
                >
                  <div className="flex flex-wrap items-center gap-sm">
                    <p className="text-title font-medium leading-title text-foreground">
                      {formatOccurrenceDateTime(occurrence)}
                    </p>
                    {occurrenceCanceled ? (
                      <Badge variant="terminal">中止</Badge>
                    ) : null}
                    {focusOccurrenceId === occurrence.id ? (
                      <Badge variant="outline">選択した公演回</Badge>
                    ) : null}
                  </div>
                  {doors !== null || ends !== null ? (
                    <p className="text-body-sm text-muted-foreground">
                      {[doors, ends]
                        .filter((value) => value !== null)
                        .join(" / ")}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <ParticipationControls
                      eventId={eventId}
                      occurrenceId={occurrence.id}
                      initialStatus={myParticipation?.status ?? null}
                      participationUnavailable={!participationLookup.ok}
                      isEffectivelyCanceled={occurrenceCanceled}
                    />

                    {canInvite ? (
                      <InviteForm occurrenceId={occurrence.id} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
