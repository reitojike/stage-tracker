'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}

/**
 * Minimal reusable bottom-sheet primitive (Issue #230 addendum: "reuse the
 * existing FilterSheet visual vocabulary rather than introducing a new
 * surface language"), extracted from src/app/catalog/_components/
 * FilterSheet.tsx's own native-<dialog> pattern - same overlay, sheet
 * surface, top-only radius, and dismiss-without-committing behavior (Escape,
 * backdrop click, or this header's own quiet 閉じる, all funnel through the
 * dialog's native `close` event) - plus a header row with a title and close
 * button, which FilterSheet does not need (it dismisses via its own footer
 * actions) but the addendum's Participation/Invite sheets do.
 *
 * Deliberately does not refactor FilterSheet itself onto this primitive:
 * FilterSheet is unrelated to Issue #230's scope, and duplicating its proven
 * CSS pattern here is a smaller, lower-risk change than pulling its own
 * working implementation onto a new shared abstraction it was never asked
 * to move to.
 *
 * A caller owns everything below the header (`children`) - this component
 * has no notion of choices, forms, or save/confirm semantics of its own.
 */
export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={() => {
        onOpenChange(false);
      }}
      onClick={(event) => {
        // A click landing on the <dialog> element itself (never a child) is
        // a backdrop click - dismiss the same way Escape or the header's
        // 閉じる button would, via the dialog's own native `close`.
        if (event.target === dialogRef.current) {
          dialogRef.current.close();
        }
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.header}>
          <p id={titleId} className={styles.title}>
            {title}
          </p>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              dialogRef.current?.close();
            }}
          >
            閉じる
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </dialog>
  );
}
