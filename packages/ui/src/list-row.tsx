import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from './lib/utils';

export function CompactList({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="compact-list"
      className={cn('flex flex-col border-t border-border', className)}
      {...props}
    />
  );
}

export function ListRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-row"
      className={cn(
        'relative flex min-h-11 min-w-0 items-start gap-sm border-b border-border py-sm',
        className,
      )}
      {...props}
    />
  );
}

type ListRowLinkProps = ComponentProps<typeof Link> & {
  trailing?: ReactNode | false;
};

/** Whole-row navigation for rows without nested interactive controls. */
export function ListRowLink({ children, className, trailing, ...props }: ListRowLinkProps) {
  return (
    <Link
      data-slot="list-row-link"
      className={cn(
        'group flex min-h-11 min-w-0 touch-manipulation items-start gap-sm border-b border-border py-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {trailing === false ? null : (
        <span className="flex min-h-7 shrink-0 items-center text-icon-affordance group-hover:text-foreground">
          {trailing ?? <ChevronRight aria-hidden className="size-4" />}
        </span>
      )}
    </Link>
  );
}

/**
 * Stretched row link for rows that also contain buttons or external links.
 * Interactive siblings must use ListRowActions so they stay above it.
 */
export function ListRowOverlayLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="list-row-overlay-link"
      className={cn(
        'absolute inset-0 z-0 touch-manipulation focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}

export function ListRowActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="list-row-actions"
      className={cn('relative z-10 flex flex-wrap items-center gap-xs', className)}
      {...props}
    />
  );
}

export function ListRowChevron({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 flex min-h-7 shrink-0 items-center text-icon-affordance',
        className,
      )}
    >
      <ChevronRight className="size-4" />
    </span>
  );
}
