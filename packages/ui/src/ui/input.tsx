'use client';

import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/utils';
import { mergeDescribedBy, useFieldContext } from './field';

export function Input({
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: ComponentPropsWithRef<'input'>) {
  const field = useFieldContext();

  return (
    <input
      data-slot="input"
      id={id ?? field?.id}
      aria-describedby={mergeDescribedBy(ariaDescribedBy, field?.descriptionId, field?.errorId)}
      aria-invalid={ariaInvalid ?? (field?.hasError ? true : undefined)}
      className={cn(
        'flex h-9 w-full min-w-0 rounded-control border border-input bg-background px-sm text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-(length:--focus-ring-width) aria-invalid:ring-destructive/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
        className,
      )}
      {...props}
    />
  );
}
