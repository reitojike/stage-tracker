import { PageHeading } from "@stage-tracker/ui";

/**
 * This loading boundary owns the pending-state presentation for event edit.
 * The heading is fixed and does not depend on data that has not been read.
 */
export default function EditEventLoading() {
  return (
    <>
      <PageHeading>イベントを編集</PageHeading>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </>
  );
}
