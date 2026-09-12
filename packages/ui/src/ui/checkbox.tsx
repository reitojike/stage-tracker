'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '../lib/utils';

export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'inline-flex size-[var(--size-checkbox-box)] shrink-0 touch-manipulation items-center justify-center rounded-control-sm border border-input bg-background text-primary-foreground outline-none data-checked:border-primary data-checked:bg-primary focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center"
      >
        <Check aria-hidden className="size-[var(--size-checkbox-glyph)]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
