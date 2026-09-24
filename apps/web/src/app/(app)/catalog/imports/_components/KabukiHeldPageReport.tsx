import { SectionHeading, StatePanel } from "@stage-tracker/ui";
import type { ReadState } from "@/lib/data/read-result";
import type { KabukiHeldPageReport as Report } from "../_lib/held-page-loader";

export function KabukiHeldPageReport({
  state,
}: {
  readonly state: ReadState<Report | null>;
}) {
  return (
    <section
      className="flex flex-col gap-sm"
      aria-labelledby="kabuki-held-heading"
    >
      <div className="flex flex-col gap-2xs">
        <SectionHeading id="kabuki-held-heading">
          歌舞伎の解析保留ページ
        </SectionHeading>
        <p className="text-body-sm text-muted-foreground">
          直近の完了した取得で解釈できなかった公演です。今回の候補には含めません。以前の候補を承認・反映する前にも、公式ページで日程を確認してください。
        </p>
      </div>
      {state.variant === "unavailable" ? (
        <StatePanel variant="unavailable" title="保留ページを表示できません" />
      ) : state.variant === "error" ? (
        <StatePanel variant="error" title="保留ページの取得に失敗しました" />
      ) : state.variant === "empty" || state.data === null ? (
        <p className="text-body-sm text-muted-foreground">
          完了した歌舞伎の取得履歴はまだありません。
        </p>
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
              この取得で解析保留のページはありません。
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
                    （{page.startsOn}〜{page.endsOn}）— 日程の解釈を要確認
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
