import Link from "next/link";
import {
  canInviteToOccurrence,
  compareInstants,
  eventIdSchema,
  isCanceled,
  isEffectivelyCanceled,
  userIdSchema,
} from "@stage-tracker/domain";
import { Badge, StatePanel } from "@stage-tracker/ui";
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

const CONTENT_CLASS =
  "mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-lg p-md";

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
        <BackLink href={backHref} />
        <StatePanel variant="empty" title="指定された公演が見つかりません" />
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
        <BackLink href={backHref} />
        <StatePanel variant="unavailable" title="ログインが必要です" />
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
        <BackLink href={backHref} />
        <StatePanel
          variant={eventState.variant}
          title={
            eventState.variant === "empty"
              ? "指定された公演が見つかりません"
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
        <BackLink href={backHref} />
        <StatePanel variant="empty" title="指定された公演が見つかりません" />
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
      <BackLink href={backHref} />

      <header className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex min-w-0 items-center gap-sm">
          <h1 className="min-w-0 break-words text-heading font-semibold leading-heading text-foreground">
            {eventDetail.event.title}
          </h1>
          {isCanceled(eventDetail.event) ? (
            <Badge variant="terminal">中止</Badge>
          ) : null}
        </div>
        {eventDetail.event.ownerId === user.id ? (
          <Link
            href={buildCatalogEditHref(eventId, search)}
            className="inline-flex h-9 shrink-0 items-center rounded-control border border-input px-md text-body-sm font-medium text-foreground hover:bg-muted"
          >
            編集
          </Link>
        ) : null}
        {eventDetail.event.venue !== null ? (
          <p className="basis-full text-body-sm text-muted-foreground">
            {eventDetail.event.venue}
          </p>
        ) : null}
      </header>

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
              ? (participationLookup.byOccurrenceId.get(occurrence.id) ?? null)
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
                    ? "flex flex-col gap-sm bg-muted/60 py-md"
                    : "flex flex-col gap-sm py-md"
                }
              >
                <div className="flex flex-wrap items-center gap-sm">
                  <p className="text-title font-medium leading-title text-foreground">
                    {formatOccurrenceDateTime(occurrence)}
                  </p>
                  {occurrenceCanceled ? (
                    <Badge variant="terminal">中止</Badge>
                  ) : null}
                </div>
                {doors !== null || ends !== null ? (
                  <p className="text-body-sm text-muted-foreground">
                    {[doors, ends]
                      .filter((value) => value !== null)
                      .join(" / ")}
                  </p>
                ) : null}

                <ParticipationControls
                  eventId={eventId}
                  occurrenceId={occurrence.id}
                  initialStatus={myParticipation?.status ?? null}
                  participationUnavailable={!participationLookup.ok}
                  isEffectivelyCanceled={occurrenceCanceled}
                />

                {canInvite ? <InviteForm occurrenceId={occurrence.id} /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BackLink({ href }: { readonly href: string }) {
  return (
    <Link
      href={href}
      className="w-fit text-body-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      ← 一覧へ戻る
    </Link>
  );
}
