/** Keeps the ticket page heading stable while the timeline resolves. */
export default function TicketsLoading() {
  return (
    <>
      <h1 className="text-heading font-semibold text-foreground">チケット</h1>
      <p role="status" className="text-body-sm text-muted-foreground">
        チケットスケジュールを読み込み中
      </p>
    </>
  );
}
