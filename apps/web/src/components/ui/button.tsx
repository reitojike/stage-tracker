import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * shadcn generates Button with 2 already-independent axes: `variant`
 * (meaning) and `size` (dimension). This resolves decisions.md A1: legacy
 * stage-tracker's single `variant` enum mixed meaning and size (`secondary`
 * and `small` were the same chrome at 2 different sizes; `quiet`/`icon`/
 * `danger` mixed "emphasis" with "shape"). v2 keeps shadcn's 2-axis shape
 * rather than reintroducing a 6-value legacy-named enum. The mapping from
 * legacy variant -> (variant, size) is:
 *
 * | legacy     | v2 `variant`  | v2 `size`        | meaning kept                              |
 * | ---------- | ------------- | ----------------- | ------------------------------------------ |
 * | `primary`  | `default`     | `default`          | main action                                |
 * | `secondary`| `outline`     | `default`          | standard / reversible action               |
 * | `small`    | `outline`     | `sm`               | same chrome as `secondary`, compact size   |
 * | `quiet`    | `ghost`       | `default` or `sm`  | lowest-emphasis, text-only action          |
 * | `icon`     | `ghost`       | `icon`             | icon-only, 40x40 tap target                |
 * | `danger`   | `destructive` | `default`          | irreversible/destructive action            |
 *
 * `danger` -> `destructive` is the one semantically load-bearing mapping:
 * shadcn's `destructive` already means "irreversible/destructive action"
 * (same as `--destructive`/`--color-danger` in globals.css), so it is
 * mapped by meaning, not introduced as a new variant. See
 * button.stories.tsx's `LegacyVariantMapping` story for all 6 rendered
 * side by side.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-(--opacity-disabled) aria-invalid:border-destructive aria-invalid:ring-(length:--focus-ring-width) aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // 40x40 rather than shadcn's default size-8 (32px): this is the
        // exact dimension of legacy's `icon` Button variant
        // (docs/v2/oracle-routes-ui.md §3). Uses Tailwind's built-in
        // `size-10` spacing step, not an invented dimension.
        icon: "size-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
