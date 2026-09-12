'use client';

import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { cn } from '../lib/utils';

export function RadioGroup<Value>({ className, ...props }: RadioGroupPrimitive.Props<Value>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('flex flex-wrap gap-xs', className)}
      {...props}
    />
  );
}

export function RadioChip<Value>({ className, ...props }: RadioPrimitive.Root.Props<Value>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-chip"
      className={cn(
        'flex min-h-11 flex-1 basis-[76px] touch-manipulation cursor-pointer items-center justify-center rounded-control border border-input px-sm text-center text-body-sm text-text-tertiary outline-none data-checked:border-primary data-checked:bg-primary data-checked:font-semibold data-checked:text-primary-foreground focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
        className,
      )}
      {...props}
    />
  );
}
