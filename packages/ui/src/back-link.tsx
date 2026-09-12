import type { ComponentProps } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cn } from './lib/utils';
import { TAP_TARGET_44_CLASS } from './tap-target';

export type BackLinkProps = ComponentProps<typeof Link>;

/** Shared contextual back navigation with a compact face and 44px hit area. */
export function BackLink({ children, className, ...props }: BackLinkProps) {
  return (
    <Link
      data-slot="back-link"
      className={cn(
        TAP_TARGET_44_CLASS,
        'inline-flex w-fit items-center gap-2xs text-body-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      <ChevronLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
