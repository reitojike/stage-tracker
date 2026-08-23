'use client';

import { useLinkStatus } from 'next/link';
import { LoadingIndicator } from './LoadingIndicator';

export interface LinkPendingProps {
  label?: string;
}

/**
 * Inline "this tap was accepted" feedback for one `<Link>`, rendered only
 * while that link's own navigation is in flight. Must be a descendant of
 * the `<Link>` it reports on - `useLinkStatus` reads that link's context
 * and otherwise just stays `pending: false`.
 *
 * Gate A runs against a remote deployment where a server navigation can
 * take a few seconds (#69/#70). Without this, a tapped link is visually
 * identical to an untapped one for the whole round trip and the user
 * re-taps. The route-level `loading.tsx` does not cover this: it renders
 * on the *destination* segment once the transition is already underway,
 * so it cannot answer "did my tap register" on the screen being left.
 */
export function LinkPending({ label = '移動中' }: LinkPendingProps) {
  const { pending } = useLinkStatus();

  return pending ? <LoadingIndicator size="sm" label={label} /> : null;
}
