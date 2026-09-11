'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { cn } from './lib/utils';

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly bodyClassName?: string;
  readonly footer?: ReactNode;
  readonly showCloseButton?: boolean;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  bodyClassName,
  footer,
  showCloseButton = true,
}: SheetProps) {
  const focusReturnRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const activeElement = document.activeElement;
      focusReturnRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    }
    if (!open && wasOpenRef.current) focusReturnRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);

  return (
    <Dialog.Root open={open} modal onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop data-testid="sheet-backdrop" className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden">
          <Dialog.Popup
            finalFocus={focusReturnRef}
            className="relative flex max-h-[min(80vh,640px)] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[var(--radius-control)] border border-border bg-background text-foreground shadow-lg outline-none"
          >
            <div className="flex shrink-0 items-center justify-between gap-sm border-b border-border px-md py-sm">
              <Dialog.Title className="text-title font-semibold leading-title">
                {title}
              </Dialog.Title>
              {showCloseButton ? (
                <Dialog.Close
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-control border border-transparent px-sm text-body-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {'閉じる'}
                </Dialog.Close>
              ) : null}
            </div>
            <div className={cn('min-h-0 flex-1 overflow-y-auto px-md py-md', bodyClassName)}>
              {children}
            </div>
            {footer !== undefined ? (
              <div className="shrink-0 border-t border-border bg-background px-md py-sm pb-[calc(var(--space-sm)+env(safe-area-inset-bottom))]">
                {footer}
              </div>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
