import {
  canInviteToOccurrence,
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
  CompactList,
  LinkButton,
  ListRow,
  ListRowActions,
  PageHeading,
  SectionHeading,
  StatePanel,
} from "@stage-tracker/ui";
import {
  classifyListReadResult,
  getEventWithOccurrences,
  listMyParticipations,
} from "@/lib/data";
import { READ_FAILURE_RETRY_HINT_JA } from "@/app/_lib/read-state";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { InviteForm } from "./_components/InviteForm";
import { OccurrenceFocusCue } from "./_components/OccurrenceFocusCue";
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
import { EVENT_NOT_FOUND_TITLE } from "./_lib/eventCopy";
import { buildParticipationLookup } from "./_lib/participationLookup";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<CatalogSearchParams>;
}

const CONTENT_CLASS = "flex w-full flex-col gap-md";

/**
 * `/catalog/events/[eventId]` event detail route. Event/Occurrence lifecycle
 * semantics follow Spec 005; this Server Component owns the exact route,
 * read orchestration, and presentation.
 *
 * The page-level auth check complements the default-deny proxy boundary.
 * Database RLS/RPC remains the write authorization boundary; exact route and
 * component behavior stay owned by runtime and tests.
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
        <StatePanel variant="empty" title={EVENT_NOT_FOUND_TITLE} />
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
              ? EVENT_NOT_FOUND_TITLE
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
        <StatePanel variant="empty" title={EVENT_NOT_FOUND_TITLE} />
      </div>
    );
  }

  // Participation read failure is shown separately while the event remains visible.
  // The page keeps each read independently degradable.
  const participationState = classifyListReadResult(participationsReadResult);
  const participationLookup = buildParticipationLookup(
    participationState,
    eventId,
  );

  const focusOccurrenceId =
    typeof search.occurrence === "string" ? search.occurrence : null;
  const occurrences = eventDetail.occurrences;

  return (
    <div className={CONTENT_CLASS}>
      <ScrollToFocusedOccurrence occurrenceId={focusOccurrenceId} />
      <BackLink href={backHref}>一覧へ戻る</BackLink>

      <header className="flex flex-wrap items-center justify-between gap-sm border-b-2 border-foreground pb-card-block">
        <div className="flex min-w-0 items-center gap-sm">
          <PageHeading className="min-w-0 break-words">
            {eventDetail.event.title}
          </PageHeading>
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
        <SectionHeading
          id="event-occurrences-heading"
          className="flex items-baseline justify-between border-b-2 border-foreground pb-card-block"
        >
          公演回{" "}
          <span className="font-normal text-muted-foreground">
            {occurrences.length}件
          </span>
        </SectionHeading>
        {occurrences.length === 0 ? (
          <StatePanel
            variant="empty"
            title="公演回はまだ登録されていません"
            description="開催期間は決まっていますが、具体的な公演回はまだ発表されていません。"
          />
        ) : (
          <CompactList>
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
                <li key={occurrence.id} id={`occurrence-${occurrence.id}`}>
                  <ListRow
                    className={
                      focusOccurrenceId === occurrence.id
                        ? "flex-col gap-xs rounded-control-sm px-sm ring-1 ring-inset ring-primary"
                        : "flex-col gap-xs"
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
                        <OccurrenceFocusCue />
                      ) : null}
                    </div>
                    {doors !== null || ends !== null ? (
                      <p className="text-body-sm text-muted-foreground">
                        {[doors, ends]
                          .filter((value) => value !== null)
                          .join(" / ")}
                      </p>
                    ) : null}

                    <ListRowActions className="w-full justify-between">
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
                    </ListRowActions>
                  </ListRow>
                </li>
              );
            })}
          </CompactList>
        )}
      </section>
    </div>
  );
}
