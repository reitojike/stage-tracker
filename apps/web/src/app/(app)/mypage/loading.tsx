import { PageHeading } from "@stage-tracker/ui";

/**
 * `specs/009-authentication-account-access/spec.md`: `/mypage` の `loading` は Server
 * Component で十分（URL 依存の見出し再構築は不要）。
 */
export default function MyPageLoading() {
  return (
    <>
      <PageHeading>マイページ</PageHeading>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </>
  );
}
