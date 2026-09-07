import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

/**
 * stage-tracker's Badge is a 5-variant, shape-based semantic vocabulary, not
 * shadcn's default default/secondary/destructive/outline/ghost/link set -
 * see docs/v2/oracle-routes-ui.md §3 "Badge" and §4 "色". Every variant maps
 * to exactly one existing design token; no new color was invented here.
 *
 * - `outline`  : classification (組 / 一般発売 etc.) - a neutral label, not
 *                a status.
 * - `subtle`   : an ongoing / not-yet-complete intention.
 * - `done`     : an action the *user* completed. Distinguished from
 *                `subtle` by tone *and* by an always-rendered checkmark
 *                glyph (docs: "トーン＋component側チェックマークで区別") -
 *                this is why `done` renders its own icon rather than
 *                leaving that to the caller.
 * - `deadline` : a deadline that is still reachable (in time).
 * - `terminal` : ended / no longer actionable.
 *
 * The oracle is explicit that these 5 are *not* told apart by color alone
 * (`terminal` and `deadline` are both "serious" tones); each variant's
 * meaning must be read from its label text, same principle as StatePanel.
 */
const badgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-badge border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        outline: 'border-input bg-transparent text-text-tertiary',
        subtle: 'bg-muted text-text-tertiary',
        done: 'bg-band-fill text-band-text',
        deadline: 'bg-destructive text-danger-on',
        terminal: 'bg-terminal text-terminal-on',
      },
    },
    // No default variant, matching StatePanel's "no default" policy: which
    // of the 5 meanings applies is a product decision the call site must
    // make, not something Badge should guess.
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export type BadgeProps = ComponentProps<'span'> & {
  variant: BadgeVariant;
};

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {variant === 'done' ? <Check aria-hidden /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
