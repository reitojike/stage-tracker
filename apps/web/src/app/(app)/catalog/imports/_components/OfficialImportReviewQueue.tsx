"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRenderableHttpUrl } from "@stage-tracker/domain";
import {
  AnchorButton,
  Badge,
  Button,
  Input,
  StatePanel,
  WriteNotice,
} from "@stage-tracker/ui";
import type { ReadState } from "@/lib/data/read-result";
import type {
  EventReviewProposal,
  EventReviewOccurrence,
  OfficialImportReviewCandidate,
  TicketOpportunityReviewProposal,
} from "../_lib/review-types";

export interface OfficialImportReviewQueueProps {
  readonly state: ReadState<readonly OfficialImportReviewCandidate[]>;
  readonly reviewAction: OfficialImportReviewAction;
  readonly applyAction: OfficialImportApplyAction;
  readonly bindAction?: OfficialImportBindAction | undefined;
  readonly lookupEventAction?: OfficialImportEventLookupAction | undefined;
}

interface BindableEvent {
  readonly id: string;
  readonly title: string;
  readonly venue: string | null;
  readonly startsOn: string;
  readonly endsOn: string;
}

export type OfficialImportBindAction = (input: {
  readonly candidateId: string;
  readonly eventId: string;
}) => Promise<
  | {
      readonly data?: unknown | undefined;
      readonly serverError?: { readonly message: string } | undefined;
      readonly validationErrors?: unknown | undefined;
    }
  | undefined
>;

export type OfficialImportEventLookupAction = (input: {
  readonly eventId: string;
}) => Promise<
  | {
      readonly data?: BindableEvent | undefined;
      readonly serverError?: { readonly message: string } | undefined;
      readonly validationErrors?: unknown | undefined;
    }
  | undefined
>;

export type OfficialImportReviewAction = (input: {
  readonly candidateId: string;
  readonly decision: "approved" | "rejected";
}) => Promise<
  | {
      readonly data?: unknown | undefined;
      readonly serverError?: { readonly message: string } | undefined;
      readonly validationErrors?: unknown | undefined;
    }
  | undefined
>;

export type OfficialImportApplyAction = (input: {
  readonly candidateId: string;
}) => Promise<
  | {
      readonly data?: unknown | undefined;
      readonly serverError?: { readonly message: string } | undefined;
      readonly validationErrors?: unknown | undefined;
    }
  | undefined
>;

const MATCH_LABELS = {
  unresolved: "未解決",
  matched: "一致",
  unmatched: "一致なし",
  ambiguous: "候補が複数",
  not_used: "未使用",
  low_confidence: "低信頼度",
} as const;

function displayTitle(candidate: OfficialImportReviewCandidate): string {
  return candidate.proposal.kind === "event"
    ? candidate.proposal.title
    : candidate.proposal.displayName;
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatOccurrenceTime(value: string | null): string {
  if (value === null) return "未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function OccurrenceValues({
  occurrences,
  emptyLabel,
}: {
  occurrences: readonly EventReviewOccurrence[];
  emptyLabel: string;
}) {
  if (occurrences.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ol className="flex list-decimal flex-col gap-2xs pl-lg text-body-sm">
      {occurrences.map((occurrence, index) => (
        <li key={occurrence.id ?? `${occurrence.startsAt}-${index}`}>
          開演 {formatOccurrenceTime(occurrence.startsAt)} / 開場{" "}
          {formatOccurrenceTime(occurrence.doorsAt)} / 終演{" "}
          {formatOccurrenceTime(occurrence.endsAt)}
        </li>
      ))}
    </ol>
  );
}

function EvidenceSummary({
  candidate,
}: {
  candidate: OfficialImportReviewCandidate;
}) {
  const labels = [
    candidate.evidence.sectionLabel,
    candidate.evidence.rowLabel,
    candidate.evidence.pdfPageNumber === undefined
      ? undefined
      : `PDF ${candidate.evidence.pdfPageNumber}ページ`,
    candidate.evidence.fragmentId,
  ].filter((value): value is string => value !== undefined);
  return labels.length === 0 ? "位置情報なし" : labels.join(" / ");
}

function EventProposal({ proposal }: { proposal: EventReviewProposal }) {
  return (
    <div className="flex flex-col gap-xs">
      <dl className="grid gap-2xs text-body-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">source key</dt>
        <dd className="break-all">{proposal.sourceKey}</dd>
        <dt className="text-muted-foreground">会場</dt>
        <dd>{proposal.venue ?? "未設定"}</dd>
        <dt className="text-muted-foreground">source URL</dt>
        <dd className="break-all">{proposal.sourceUrl ?? "未設定"}</dd>
        <dt className="text-muted-foreground">メモ</dt>
        <dd className="whitespace-pre-wrap break-words">
          {proposal.memo ?? "未設定"}
        </dd>
        <dt className="text-muted-foreground">公演期間</dt>
        <dd>
          {proposal.startsOn}〜{proposal.endsOn}
        </dd>
        <dt className="text-muted-foreground">公演回</dt>
        <dd>{proposal.occurrences.length}件</dd>
        <dt className="text-muted-foreground">ジャンル</dt>
        <dd>{proposal.genre ?? "未設定"}</dd>
        <dt className="text-muted-foreground">グループ</dt>
        <dd>
          {proposal.groups.map((group) => group.displayName).join("、") ||
            "未設定"}
        </dd>
      </dl>
      <OccurrenceValues
        occurrences={proposal.occurrences}
        emptyLabel="提案された公演回はありません。"
      />
    </div>
  );
}

function milestoneWhen(
  milestone: TicketOpportunityReviewProposal["milestones"][number],
): string {
  if (milestone.precision === "date") return milestone.date;
  if (milestone.precision === "datetime") return milestone.at;
  return `${milestone.startsAt}〜${milestone.endsAt}`;
}

function OccurrenceLocators({
  values,
  emptyLabel,
}: {
  values: readonly string[];
  emptyLabel: string;
}) {
  if (values.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="list-disc pl-lg text-body-sm">
      {values.map((value) => (
        <li key={value}>
          {formatOccurrenceTime(value)}（
          <span className="break-all">{value}</span>）
        </li>
      ))}
    </ul>
  );
}

function MilestoneValues({
  milestones,
  emptyLabel,
}: {
  milestones: TicketOpportunityReviewProposal["milestones"];
  emptyLabel: string;
}) {
  if (milestones.length === 0) {
    return <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="list-disc pl-lg text-body-sm">
      {milestones.map((milestone, index) => (
        <li key={`${milestone.type}-${index}`}>
          {milestone.type}: {milestoneWhen(milestone)}
        </li>
      ))}
    </ul>
  );
}

function TicketProposal({
  proposal,
}: {
  proposal: TicketOpportunityReviewProposal;
}) {
  return (
    <div className="flex flex-col gap-xs text-body-sm">
      <dl className="grid gap-2xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">source key</dt>
        <dd className="break-all">{proposal.sourceKey}</dd>
        <dt className="text-muted-foreground">対象Event</dt>
        <dd className="break-all">{proposal.eventSourceKey}</dd>
        <dt className="text-muted-foreground">source URL</dt>
        <dd className="break-all">{proposal.sourceUrl ?? "未設定"}</dd>
        <dt className="text-muted-foreground">メモ</dt>
        <dd className="whitespace-pre-wrap break-words">
          {proposal.memo ?? "未設定"}
        </dd>
        <dt className="text-muted-foreground">対象範囲</dt>
        <dd>
          {proposal.targetScope === "event_wide"
            ? "イベント全体"
            : `選択した公演回 ${proposal.targetOccurrences.length}件`}
        </dd>
      </dl>
      {proposal.targetScope === "selected_occurrences" ? (
        <OccurrenceLocators
          values={proposal.targetOccurrences}
          emptyLabel="選択された公演回がありません。"
        />
      ) : null}
      <MilestoneValues
        milestones={proposal.milestones}
        emptyLabel="提案された販売日程はありません。"
      />
    </div>
  );
}

function CurrentTarget({
  candidate,
}: {
  candidate: OfficialImportReviewCandidate;
}) {
  if (
    candidate.currentEvent === null &&
    candidate.currentTicketOpportunity === null
  ) {
    return <p className="text-body-sm">現在の対象: なし（新規候補）</p>;
  }
  return (
    <div className="flex flex-col gap-2xs text-body-sm">
      {candidate.currentEvent !== null ? (
        <div className="flex flex-col gap-xs">
          <dl className="grid gap-2xs sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">
              {candidate.kind === "ticket_opportunity"
                ? "提案先Event"
                : "現在のEvent"}
            </dt>
            <dd>{candidate.currentEvent.title}</dd>
            <dt className="text-muted-foreground">source key</dt>
            <dd className="break-all">
              {candidate.currentEvent.sourceKey ?? "手動登録"}
            </dd>
            <dt className="text-muted-foreground">会場</dt>
            <dd>{candidate.currentEvent.venue ?? "未設定"}</dd>
            <dt className="text-muted-foreground">source URL</dt>
            <dd className="break-all">
              {candidate.currentEvent.sourceUrl ?? "未設定"}
            </dd>
            <dt className="text-muted-foreground">メモ</dt>
            <dd className="whitespace-pre-wrap break-words">
              {candidate.currentEvent.memo ?? "未設定"}
            </dd>
            <dt className="text-muted-foreground">公演期間</dt>
            <dd>
              {candidate.currentEvent.startsOn}〜{candidate.currentEvent.endsOn}
            </dd>
          </dl>
          <OccurrenceValues
            occurrences={candidate.currentEvent.occurrences}
            emptyLabel="現在の公演回はありません。"
          />
        </div>
      ) : null}
      {candidate.currentTicketOpportunity !== null ? (
        <div className="flex flex-col gap-xs">
          <dl className="grid gap-2xs sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">現在の販売情報</dt>
            <dd>{candidate.currentTicketOpportunity.displayName}</dd>
            <dt className="text-muted-foreground">現在の対象Event</dt>
            <dd>
              {candidate.currentTicketOpportunity.currentEvent.title}（
              <span className="break-all">
                {candidate.currentTicketOpportunity.currentEvent.sourceKey ??
                  "手動登録"}
              </span>
              ）
            </dd>
            <dt className="text-muted-foreground">source key</dt>
            <dd className="break-all">
              {candidate.currentTicketOpportunity.sourceKey}
            </dd>
            <dt className="text-muted-foreground">source URL</dt>
            <dd className="break-all">
              {candidate.currentTicketOpportunity.sourceUrl ?? "未設定"}
            </dd>
            <dt className="text-muted-foreground">メモ</dt>
            <dd className="whitespace-pre-wrap break-words">
              {candidate.currentTicketOpportunity.memo ?? "未設定"}
            </dd>
            <dt className="text-muted-foreground">対象範囲</dt>
            <dd>{candidate.currentTicketOpportunity.targetScope}</dd>
          </dl>
          {candidate.currentTicketOpportunity.targetScope ===
          "selected_occurrences" ? (
            <OccurrenceLocators
              values={candidate.currentTicketOpportunity.targetOccurrences}
              emptyLabel="現在選択されている公演回はありません。"
            />
          ) : null}
          <MilestoneValues
            milestones={candidate.currentTicketOpportunity.milestones}
            emptyLabel="現在の販売日程はありません。"
          />
        </div>
      ) : null}
    </div>
  );
}

function ReviewControls({
  candidate,
  reviewAction,
  rejectOnly = false,
}: {
  candidate: OfficialImportReviewCandidate;
  reviewAction: OfficialImportReviewAction;
  rejectOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [completed, setCompleted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function review(decision: "approved" | "rejected") {
    setNotice(null);
    setErrorMessage(null);
    startTransition(async () => {
      const result = await reviewAction({
        candidateId: candidate.id,
        decision,
      });
      setAttempt((value) => value + 1);
      if (result?.serverError) {
        setErrorMessage(result.serverError.message);
        return;
      }
      if (result?.validationErrors || !result?.data) {
        setErrorMessage("入力内容を確認してください。");
        return;
      }
      setCompleted(true);
      setNotice(decision === "approved" ? "承認しました。" : "却下しました。");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2xs">
      <div className="flex flex-wrap gap-xs">
        {rejectOnly ? null : (
          <Button
            type="button"
            disabled={isPending || completed}
            onClick={() => review("approved")}
          >
            承認
          </Button>
        )}
        <Button
          type="button"
          variant="destructive"
          disabled={isPending || completed}
          onClick={() => review("rejected")}
        >
          {rejectOnly ? "取り込み不要として却下" : "却下"}
        </Button>
      </div>
      {errorMessage !== null ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorMessage}
        </p>
      ) : (
        <WriteNotice notice={notice} attempt={attempt} />
      )}
    </div>
  );
}

function eventIdFromInput(value: string): string | null {
  const trimmed = value.trim();
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  if (id.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.origin !== "https://stage-tracker.com") return null;
    const match = /^\/catalog\/events\/([0-9a-f-]+)\/?$/iu.exec(url.pathname);
    return match !== null && id.test(match[1] ?? "")
      ? (match[1] ?? null)
      : null;
  } catch {
    return null;
  }
}

function ManualBindingControls({
  candidate,
  bindAction,
  lookupEventAction,
}: {
  candidate: OfficialImportReviewCandidate;
  bindAction: OfficialImportBindAction;
  lookupEventAction: OfficialImportEventLookupAction;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<BindableEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [completed, setCompleted] = useState(false);

  function lookup() {
    const eventId = eventIdFromInput(value);
    setPreview(null);
    setErrorMessage(null);
    if (eventId === null) {
      setErrorMessage("EventのURLまたはIDを入力してください。");
      return;
    }
    startTransition(async () => {
      const result = await lookupEventAction({ eventId });
      if (result?.serverError || result?.validationErrors || !result?.data) {
        setErrorMessage(
          result?.serverError?.message ?? "Eventを確認できませんでした。",
        );
        return;
      }
      setPreview(result.data);
    });
  }

  function bind() {
    if (preview === null) return;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await bindAction({
        candidateId: candidate.id,
        eventId: preview.id,
      });
      if (result?.serverError || result?.validationErrors || !result?.data) {
        setErrorMessage(
          result?.serverError?.message ?? "紐づけを保存できませんでした。",
        );
        return;
      }
      setCompleted(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-xs rounded-lg border border-border p-sm">
      <p className="text-body-sm font-semibold">既存Eventに紐づける</p>
      <p className="text-body-sm text-muted-foreground">
        公演名や期間が一致しない場合は、正しいEventを確認して指定できます。
      </p>
      {(candidate.suggestedEvents?.length ?? 0) > 0 ? (
        <div className="flex flex-col gap-2xs">
          <p className="text-body-sm font-semibold">もしかしてこのEvent？</p>
          <p className="text-body-sm text-muted-foreground">
            会場と公演年から探した候補です。公演名・期間を元ページと照らして選んでください。
          </p>
          {candidate.suggestedEvents?.map((event) => (
            <Button
              key={event.id}
              type="button"
              variant="outline"
              disabled={isPending || completed}
              onClick={() => {
                setValue(event.id);
                setPreview(event);
                setErrorMessage(null);
              }}
            >
              {event.title} / {event.venue ?? "会場未設定"} / {event.startsOn}〜
              {event.endsOn}
            </Button>
          ))}
        </div>
      ) : null}
      <label htmlFor={`binding-event-${candidate.id}`} className="text-body-sm">
        Event URL または ID
      </label>
      <Input
        id={`binding-event-${candidate.id}`}
        value={value}
        disabled={isPending || completed}
        onChange={(event) => {
          setValue(event.target.value);
          setPreview(null);
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending || completed}
          onClick={lookup}
        >
          Eventを確認
        </Button>
      </div>
      {preview !== null ? (
        <div className="flex flex-col gap-2xs rounded-lg bg-muted p-sm text-body-sm">
          <p>
            {preview.title} / {preview.venue ?? "会場未設定"}
          </p>
          <p>
            {preview.startsOn}〜{preview.endsOn}
          </p>
          <AnchorButton
            href={`/catalog/events/${preview.id}`}
            target="_blank"
            rel="noreferrer noopener"
            variant="link"
            size="sm"
          >
            Event詳細を開く
          </AnchorButton>
          <Button
            type="button"
            disabled={isPending || completed}
            onClick={bind}
          >
            このEventに紐づけて承認
          </Button>
        </div>
      ) : null}
      {errorMessage !== null ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

const RETRYABLE_APPLY_FAILURES = new Set([
  "write_conflict",
  "provider_unavailable",
  "unexpected",
]);

function isQueuedApplyLeaseExpired(
  candidate: OfficialImportReviewCandidate,
): boolean {
  return (
    candidate.applyStatus === "queued" &&
    candidate.applyLeaseExpiresAt !== null &&
    Date.parse(candidate.applyLeaseExpiresAt) <= Date.now()
  );
}

function applyFailureMessage(
  candidate: OfficialImportReviewCandidate,
): string | null {
  const failure = candidate.applyFailureClassification;
  if (failure === null) return null;
  if (failure === "source_changed") {
    return "承認後に現在のカタログ状態または反映ルールが変わりました。新しい候補を取り込み、再確認してください。";
  }
  if (failure === "identity_ambiguous") {
    return "対象の同一性を安全に確定できませんでした。新しい候補で公式IDを再確認してください。";
  }
  if (failure === "target_missing") {
    return "反映先のEventを最新状態から解決できませんでした。新しい候補を取り込み、再確認してください。";
  }
  if (failure === "validation" || failure === "policy_blocked") {
    return "候補が現在の反映ルールを満たしていません。新しい候補を取り込み、再確認してください。";
  }
  return "反映処理に失敗しました。カタログへの不完全な変更は候補の完了として扱われていません。";
}

function ApplyControls({
  candidate,
  applyAction,
}: {
  candidate: OfficialImportReviewCandidate;
  applyAction: OfficialImportApplyAction;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [completed, setCompleted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queuedLeaseExpired = isQueuedApplyLeaseExpired(candidate);
  const retryable =
    candidate.applyStatus === "not_started" ||
    queuedLeaseExpired ||
    (candidate.applyFailureClassification !== null &&
      RETRYABLE_APPLY_FAILURES.has(candidate.applyFailureClassification));

  function apply() {
    setNotice(null);
    setErrorMessage(null);
    startTransition(async () => {
      const result = await applyAction({ candidateId: candidate.id });
      setAttempt((value) => value + 1);
      if (result?.serverError) {
        setErrorMessage(result.serverError.message);
        return;
      }
      if (result?.validationErrors || !result?.data) {
        setErrorMessage("入力内容を確認してください。");
        return;
      }
      setCompleted(true);
      setNotice("反映処理を開始しました。");
      router.refresh();
    });
  }

  const failureMessage = applyFailureMessage(candidate);
  return (
    <div className="flex flex-col gap-2xs">
      {failureMessage === null ? null : (
        <p role="alert" className="text-body-sm text-destructive">
          {failureMessage}
        </p>
      )}
      {candidate.applyStatus === "queued" && !queuedLeaseExpired ? (
        <p className="text-body-sm text-muted-foreground">
          反映処理を実行中です。しばらくしてから画面を更新してください。
        </p>
      ) : retryable ? (
        <Button type="button" disabled={isPending || completed} onClick={apply}>
          {candidate.applyStatus === "not_started"
            ? "カタログへ反映"
            : "反映を再試行"}
        </Button>
      ) : null}
      {errorMessage !== null ? (
        <p role="alert" className="text-body-sm text-destructive">
          {errorMessage}
        </p>
      ) : (
        <WriteNotice notice={notice} attempt={attempt} />
      )}
    </div>
  );
}

function candidateStatusLabel(
  candidate: OfficialImportReviewCandidate,
): string {
  if (candidate.reviewStatus === "pending") return "確認待ち";
  if (candidate.reviewStatus === "blocked_for_identity_review")
    return "同一性確認が必要";
  if (isQueuedApplyLeaseExpired(candidate)) return "反映再試行待ち";
  if (candidate.applyStatus === "queued") return "反映処理中";
  if (candidate.applyStatus === "failed") return "反映失敗";
  return "承認済み・反映待ち";
}

function CandidateCard({
  candidate,
  reviewAction,
  applyAction,
  bindAction,
  lookupEventAction,
}: {
  candidate: OfficialImportReviewCandidate;
  reviewAction: OfficialImportReviewAction;
  applyAction: OfficialImportApplyAction;
  bindAction?: OfficialImportBindAction | undefined;
  lookupEventAction?: OfficialImportEventLookupAction | undefined;
}) {
  return (
    <article
      aria-labelledby={`candidate-${candidate.id}`}
      className="flex flex-col gap-md rounded-xl border border-border bg-card p-md"
    >
      <header className="flex flex-col gap-xs">
        <div className="flex flex-wrap gap-xs">
          <Badge variant="outline">
            {candidate.kind === "event" ? "Event" : "TicketOpportunity"}
          </Badge>
          <Badge
            variant={
              candidate.reviewStatus === "pending"
                ? "subtle"
                : candidate.reviewStatus === "approved"
                  ? "outline"
                  : "terminal"
            }
          >
            {candidateStatusLabel(candidate)}
          </Badge>
        </div>
        <h2
          id={`candidate-${candidate.id}`}
          className="text-title font-semibold leading-title"
        >
          {displayTitle(candidate)}
        </h2>
        <p className="text-caption text-muted-foreground">
          {candidate.sourceId}・{formatObservedAt(candidate.observedAt)}
        </p>
      </header>

      <section className="flex flex-col gap-2xs" aria-label="情報源">
        <h3 className="font-semibold">情報源</h3>
        <p className="text-body-sm">
          公式ID: {candidate.officialExternalId ?? "なし"}
        </p>
        <p className="text-body-sm">
          根拠位置: <EvidenceSummary candidate={candidate} />
        </p>
        {isRenderableHttpUrl(candidate.canonicalUrl) ? (
          <AnchorButton
            href={candidate.canonicalUrl}
            target="_blank"
            rel="noreferrer noopener"
            variant="link"
            size="sm"
          >
            公式情報を開く
          </AnchorButton>
        ) : null}
      </section>

      <section className="flex flex-col gap-2xs" aria-label="照合結果">
        <h3 className="font-semibold">照合結果</h3>
        <p className="text-body-sm">
          決定的照合: {MATCH_LABELS[candidate.match.deterministicStatus]} /
          意味照合: {MATCH_LABELS[candidate.match.semanticStatus]}
        </p>
        {candidate.match.jev !== null ? (
          <div className="rounded-lg bg-muted p-sm text-body-sm">
            <p className="font-semibold">
              Jev参考情報（判定の根拠ではありません）
            </p>
            <p>
              {candidate.match.jev.provider} / {candidate.match.jev.model} /
              選択 {candidate.match.jev.choice}
            </p>
            {candidate.match.jev.confidence === undefined ? null : (
              <p>信頼度 {Math.round(candidate.match.jev.confidence * 100)}%</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-2xs" aria-label="現在の対象">
        <h3 className="font-semibold">現在の対象</h3>
        <CurrentTarget candidate={candidate} />
      </section>

      <section className="flex flex-col gap-2xs" aria-label="提案内容">
        <h3 className="font-semibold">提案内容</h3>
        {candidate.proposal.kind === "event" ? (
          <EventProposal proposal={candidate.proposal} />
        ) : (
          <TicketProposal proposal={candidate.proposal} />
        )}
      </section>

      <section className="flex flex-col gap-2xs" aria-label="変更計画">
        <h3 className="font-semibold">変更計画</h3>
        <p className="text-body-sm">操作: {candidate.plan.action}</p>
        <ul className="list-disc pl-lg text-body-sm">
          {candidate.plan.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      </section>

      {candidate.blockedReason !== null ? (
        <div className="flex flex-col gap-xs">
          <p
            role="alert"
            className="rounded-lg border border-border bg-muted p-sm text-body-sm"
          >
            {candidate.blockedReason}
          </p>
          {candidate.kind === "ticket_opportunity" &&
          candidate.reviewStatus === "blocked_for_identity_review" ? (
            <div className="flex flex-col gap-sm">
              {bindAction !== undefined && lookupEventAction !== undefined ? (
                <ManualBindingControls
                  candidate={candidate}
                  bindAction={bindAction}
                  lookupEventAction={lookupEventAction}
                />
              ) : null}
              <ReviewControls
                candidate={candidate}
                reviewAction={reviewAction}
                rejectOnly
              />
            </div>
          ) : null}
        </div>
      ) : candidate.reviewStatus === "pending" ? (
        <ReviewControls candidate={candidate} reviewAction={reviewAction} />
      ) : (
        <ApplyControls candidate={candidate} applyAction={applyAction} />
      )}
    </article>
  );
}

export function OfficialImportReviewQueue({
  state,
  reviewAction,
  applyAction,
  bindAction,
  lookupEventAction,
}: OfficialImportReviewQueueProps) {
  if (state.variant !== "populated") {
    return (
      <StatePanel
        variant={state.variant}
        title={
          state.variant === "empty"
            ? "確認待ちの候補はありません"
            : state.variant === "unavailable"
              ? "公式情報を確認する権限がありません"
              : "確認待ち候補を読み込めませんでした"
        }
        {...(state.variant === "error"
          ? { description: "時間をおいて再度お試しください。" }
          : {})}
      />
    );
  }
  const isUnchangedPending = (candidate: OfficialImportReviewCandidate) =>
    candidate.reviewStatus === "pending" &&
    candidate.applyStatus === "not_started" &&
    !candidate.plan.hasChanges &&
    candidate.match.deterministicStatus === "matched" &&
    candidate.match.semanticStatus === "not_used" &&
    (candidate.kind === "event"
      ? candidate.currentEvent?.sourceKey === candidate.proposal.sourceKey
      : candidate.currentTicketOpportunity?.sourceKey ===
        candidate.proposal.sourceKey);
  const actionable = state.data.filter(
    (candidate) => !isUnchangedPending(candidate),
  );
  return (
    <div className="flex flex-col gap-lg">
      {actionable.length === 0 && (
        <StatePanel variant="empty" title="確認が必要な候補はありません" />
      )}
      {actionable.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          reviewAction={reviewAction}
          applyAction={applyAction}
          bindAction={bindAction}
          lookupEventAction={lookupEventAction}
        />
      ))}
    </div>
  );
}
