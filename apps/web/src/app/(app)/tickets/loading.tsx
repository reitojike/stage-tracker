import { PageHeading } from "@stage-tracker/ui";

/** Keeps the ticket page heading stable while the timeline resolves. */
export default function TicketsLoading() {
  return (
    <>
      <PageHeading>チケット</PageHeading>
      <p role="status" className="text-body-sm text-muted-foreground">
        チケットスケジュールを読み込み中
      </p>
    </>
  );
}
