'use client';

import Link, { useLinkStatus } from 'next/link';
import { ChevronLeft, ChevronRight, LoaderCircle } from 'lucide-react';

function MonthLinkContent({ direction }: { readonly direction: 'previous' | 'next' }) {
  const { pending } = useLinkStatus();
  if (pending) {
    return (
      <>
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        <span className="sr-only">読み込み中</span>
      </>
    );
  }
  return direction === 'previous' ? (
    <ChevronLeft aria-hidden className="size-5" />
  ) : (
    <ChevronRight aria-hidden className="size-5" />
  );
}

export function MonthNavigation({
  label,
  previousHref,
  nextHref,
}: {
  readonly label: string;
  readonly previousHref: string;
  readonly nextHref: string;
}) {
  return (
    <nav className="flex min-h-11 items-center justify-between" aria-label={`${label}の月移動`}>
      <Link
        href={previousHref}
        aria-label="前の月"
        className="inline-flex size-11 touch-manipulation items-center justify-center rounded-control-sm text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50"
      >
        <MonthLinkContent direction="previous" />
      </Link>
      <span className="text-title font-semibold text-foreground">{label}</span>
      <Link
        href={nextHref}
        aria-label="次の月"
        className="inline-flex size-11 touch-manipulation items-center justify-center rounded-control-sm text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50"
      >
        <MonthLinkContent direction="next" />
      </Link>
    </nav>
  );
}
