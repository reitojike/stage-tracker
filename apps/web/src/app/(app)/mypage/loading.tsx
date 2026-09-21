import { PageHeading } from "@stage-tracker/ui";

/**
 * `/mypage` has no URL-dependent heading or back-link state, so its loading
 * boundary can remain a Server Component.
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
