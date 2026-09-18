'use client';

import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/utils';
import { mergeDescribedBy, useFieldContext } from './field';

export function Textarea({
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: ComponentPropsWithRef<'textarea'>) {
  const field = useFieldContext();

  return (
    <textarea
      data-slot="textarea"
      id={id ?? field?.id}
      aria-describedby={mergeDescribedBy(ariaDescribedBy, field?.descriptionId, field?.errorId)}
      aria-invalid={ariaInvalid ?? (field?.hasError ? true : undefined)}
      className={cn(
        'flex min-h-24 w-full min-w-0 rounded-control border border-input bg-background p-sm text-body outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-(length:--focus-ring-width) focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-(length:--focus-ring-width) aria-invalid:ring-destructive/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled)',
        className,
      )}
      {...props}
    />
  );
}
