export interface WriteNoticeProps {
  readonly notice: string | null;
  readonly attempt: number;
}

/**
 * Stable polite live region for completed write feedback. The keyed message
 * node lets an identical message be announced again for a later attempt.
 */
export function WriteNotice({ notice, attempt }: WriteNoticeProps) {
  return (
    <div role="status" aria-live="polite" className="text-body-sm text-muted-foreground">
      {notice ? <p key={attempt}>{notice}</p> : null}
    </div>
  );
}
