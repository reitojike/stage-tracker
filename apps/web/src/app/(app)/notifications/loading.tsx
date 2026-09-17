import { PageHeading } from "@stage-tracker/ui";

/** Bounded loading chrome for the authenticated Notifications route. */
export default function NotificationsLoading() {
  return (
    <div className="flex flex-col gap-md">
      <PageHeading>お知らせ</PageHeading>
      <p role="status" className="text-body-sm text-muted-foreground">
        読み込み中…
      </p>
    </div>
  );
}
