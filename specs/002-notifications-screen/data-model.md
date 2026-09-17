# Data Model: Notifications screen

## Existing persisted entity: Notification

The page consumes the existing typed six-field MVP record through
`listMyNotifications`; it does not add or change storage.

| Field               | Meaning at this screen                                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `id`                | Stable Notification identity and exact rendered-read input                  |
| `kind`              | MVP literal `invitation_received`                                           |
| `source_id`         | Soft reference to an Invitation source                                      |
| `created_at`        | Notification timestamp, displayed in Asia/Tokyo format                      |
| `read_at`           | Sole unread authority: `null` is unread; non-null is read                   |
| recipient ownership | Enforced by the authenticated Supabase client and RLS; not a route argument |

The underlying recipient field remains an authorization boundary and is not
copied into the page view model.

## Resolved page view model

`NotificationListItem` is the existing typed read result:

```text
{
  id: string,
  kind: "invitation_received",
  sourceId: string,
  createdAt: string,
  readAt: string | null,
  source: ActiveInvitationSource | ResolvedSource
}
```

`ActiveInvitationSource` carries only the identifiers needed to establish that
the recipient-visible Invitation source exists and to navigate to
`/catalog/invitations`. `ResolvedSource` carries no inferred status or history.

## State transitions

1. The server reads a bounded Notification window and resolves its Invitation
   sources.
2. Each row renders as active navigation or resolved fallback; a source read
   failure aborts the screen into the error state.
3. The client receives the exact IDs of rows rendered in that snapshot.
4. After render, the existing bounded action attempts recipient-owned idempotent
   read transitions for those IDs.
5. On action success, the local display may show those rows as read. On failure,
   the rows remain displayed as unread and a retry remains available.

Notifications persist independently of Invitation deletion and are not an
Invitation history ledger.
