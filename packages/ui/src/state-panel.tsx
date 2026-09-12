import type { ReactNode } from 'react';
import { cn } from './lib/utils';

/**
 * The 3 states a read/render decision can be in. There is no 4th "unknown"
 * bucket and no default: every call site must pick one explicitly.
 *
 * - `empty`: the read succeeded and returned zero rows.
 * - `error`: the read itself failed (network, unexpected exception, ...).
 * - `unavailable`: the caller is not allowed to see this (RLS denial,
 *   permission check failed, ...).
 *
 * docs/v2/oracle-routes-ui.md §2 records this as the cross-screen invariant:
 * an auth/permission failure or a fetch failure must never be silently
 * rendered as "0 results" (`empty`). decisions.md keeps this as one of the
 * explicitly-carried-forward invariants for v2.
 */
export const STATE_PANEL_VARIANTS = ['empty', 'error', 'unavailable'] as const;

export type StatePanelVariant = (typeof STATE_PANEL_VARIANTS)[number];

export type StatePanelProps = {
  /**
   * Required, no default value. This is the type-level half of "cannot be
   * mixed up": `variant` is a 3-member literal union with no fallback, so a
   * call site that forgets to decide, or passes an unknown string, fails
   * `tsc` rather than silently rendering as one of the other two states.
   * See state-panel.test.tsx for a compile-time regression test of this.
   */
  variant: StatePanelVariant;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

/**
 * Shared presentation for the "there is nothing (useful) to show" family of
 * screen states. All 3 variants render the exact same structure (title ->
 * description -> action) and the exact same visual treatment - the oracle
 * explicitly records that these are *not* distinguished by color or icon,
 * only by the words in `title`/`description` and (for `error`) by
 * `role="alert"`. The reasoning: a color/icon distinction invites a reader
 * to learn "this shade always means empty" and stop reading the text, which
 * is exactly what must not happen for `unavailable` (RLS-denied) or `error`
 * (a real fetch failure).
 */
export function StatePanel({ variant, title, description, action, className }: StatePanelProps) {
  return (
    <div
      data-slot="state-panel"
      data-variant={variant}
      role={variant === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-start gap-sm border-y border-border py-lg text-body-sm text-foreground',
        className,
      )}
    >
      <p className="text-title leading-title font-medium text-foreground">{title}</p>
      {description ? <p className="text-body-sm text-muted-foreground">{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
