/** `docs/v2/oracle-routes-ui.md` §1: `/catalog/invitations` の loading は
 * Server Component で十分。 */
export default function InvitationsLoading() {
  return (
    <p role="status" className="text-body-sm text-muted-foreground">
      読み込み中…
    </p>
  );
}
