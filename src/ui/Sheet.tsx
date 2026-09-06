'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './Sheet.module.css';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  /** Optional class added to the scrollable body while Sheet retains the
   * shared body/frame behavior. */
  bodyClassName?: string;
  /** Optional action content rendered after the scrollable body, outside its
   * scroll region so a caller can keep a footer reachable on short viewports.
   *
   * Pass the actions themselves, not a pre-wrapped row: Sheet owns the footer
   * bar's own presentation (placement, padding, top rule, alignment) as part
   * of owning this slot's position. Callers keep the content semantics -
   * which actions, what they submit - and any per-action sizing. */
  footer?: ReactNode;
  /** Whether the default quiet header close action is rendered. */
  showCloseButton?: boolean;
}

/**
 * Minimal reusable bottom-sheet primitive (Issue #230 addendum: "reuse the
 * existing FilterSheet visual vocabulary rather than introducing a new
 * surface language"), extracted from the native-<dialog> pattern shared by
 * the sheet consumers - same overlay, sheet surface, top-only radius, and
 * dismiss-without-committing behavior (Escape, backdrop click, or this
 * header's own quiet 閉じる, all funnel through the dialog's native `close`
 * event) - plus a header row with a title and optional close button.
 *
 * `children` owns everything in the scrollable body below the header. An
 * optional `footer` is rendered outside that scroll region so callers can
 * provide a reachable action row without taking over the dialog lifecycle.
 * Sheet owns that action row's presentation too (Issue #318) - callers pass
 * the actions, not a footer bar of their own.
 *
 * This component has no notion of choices, forms, or save/confirm semantics
 * of its own.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  bodyClassName,
  footer,
  showCloseButton = true,
}: SheetProps) {
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
      onKeyDown={(event) => {
        // Keep Escape dismissal on the shared primitive's close path even in
        // browsers that dispatch the key event without applying the native
        // dialog's implicit cancel action.
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dialogRef.current?.close();
        }
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
          {showCloseButton ? (
            <Button
              type="button"
              variant="quiet"
              className={styles.close}
              onClick={() => {
                dialogRef.current?.close();
              }}
            >
              閉じる
            </Button>
          ) : null}
        </div>
        <div className={[styles.body, bodyClassName].filter(Boolean).join(' ')}>{children}</div>
        {footer == null ? null : <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
}
