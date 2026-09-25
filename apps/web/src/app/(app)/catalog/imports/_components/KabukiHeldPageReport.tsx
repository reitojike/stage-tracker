import { SectionHeading, StatePanel } from "@stage-tracker/ui";
import type { ReadState } from "@/lib/data/read-result";
import type {
  KabukiHeldPageReport as Report,
  LatestTicketRun,
} from "../_lib/held-page-loader";

function HeldPageReport({
  state,
  headingId,
  heading,
  description,
  emptyHistory,
}: {
  readonly state: ReadState<Report | null>;
  readonly headingId: string;
  readonly heading: string;
  readonly description: string;
  readonly emptyHistory: string;
}) {
  return (
    <section className="flex flex-col gap-sm" aria-labelledby={headingId}>
      <div className="flex flex-col gap-2xs">
        <SectionHeading id={headingId}>{heading}</SectionHeading>
        <p className="text-body-sm text-muted-foreground">{description}</p>
      </div>
      {state.variant === "unavailable" ? (
        <StatePanel variant="unavailable" title="保留ページを表示できません" />
      ) : state.variant === "error" ? (
        <StatePanel variant="error" title="保留ページの取得に失敗しました" />
      ) : state.variant === "empty" || state.data === null ? (
        <p className="text-body-sm text-muted-foreground">{emptyHistory}</p>
      ) : (
        <div className="flex flex-col gap-sm">
          <p className="text-body-sm text-muted-foreground">
            取得日時：
            {new Intl.DateTimeFormat("ja-JP", {
              timeZone: "Asia/Tokyo",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(state.data.startedAt))}
          </p>
          {state.data.pages.length === 0 ? (
            <p className="text-body-sm">
              この取得で要確認のページはありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {state.data.pages.map((page) => (
                <li key={page.canonicalUrl} className="text-body-sm">
                  <a
                    href={page.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2"
                  >
                    {page.title}
                  </a>
                  <span className="text-muted-foreground">
                    {" "}
                    （{page.startsOn}〜{page.endsOn}）—{" "}
                    {page.reasonCode === "published_end_missing"
                      ? "今回の取得では終演時刻を確認できませんでした。登録済み時刻は維持し、要確認"
                      : "日程の解釈を要確認"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function KabukiHeldPageReport({
  state,
}: {
  readonly state: ReadState<Report | null>;
}) {
  return (
    <HeldPageReport
      state={state}
      headingId="kabuki-held-heading"
      heading="歌舞伎の要確認ページ"
      description="直近の完了した取得で確認が必要になった公演です。今回の候補には含めません。以前の候補を承認・反映する前にも、公式ページで日程と終演時刻を確認してください。"
      emptyHistory="完了した歌舞伎の取得履歴はまだありません。"
    />
  );
}

export function ShochikuTicketHeldPageReport({
  state,
  latestRun,
}: {
  readonly state: ReadState<Report | null>;
  readonly latestRun: ReadState<LatestTicketRun | null>;
}) {
  return (
    <div className="flex flex-col gap-sm">
      {latestRun.variant === "populated" && latestRun.data !== null ? (
        latestRun.data.status === "failed" ? (
          <StatePanel
            variant="error"
            title="直近のチケット取得は失敗しました"
            description="この取得では候補を作成していません。再実行する前に取得処理を確認してください。"
          />
        ) : latestRun.data.status === "running" ? (
          <p role="status" className="text-body-sm">
            直近のチケット取得は実行中です。完了後に画面を更新してください。
          </p>
        ) : null
      ) : latestRun.variant === "error" ? (
        <StatePanel
          variant="error"
          title="チケット取得の状態を確認できません"
        />
      ) : null}
      <HeldPageReport
        state={state}
        headingId="ticket-held-heading"
        heading="チケット販売情報の要確認ページ"
        description="直近の完了したチケット取得で発売情報を安全に確定できなかった公演です。今回の候補には含めません。元ページで確認してください。"
        emptyHistory="完了したチケット取得履歴はまだありません。"
      />
    </div>
  );
}
