import { BackLink } from "@stage-tracker/ui";

export default function OfficialImportReviewLoading() {
  return (
    <div className="flex flex-col gap-sm">
      <BackLink href="/mypage">マイページへ戻る</BackLink>
      <p role="status" className="text-body-sm text-muted-foreground">
        確認待ち候補を読み込み中…
      </p>
    </div>
  );
}
