'use client';

import {
  createContext,
  useContext,
  type HTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../lib/utils';

interface FieldContextValue {
  readonly id: string;
  readonly required: boolean;
  readonly descriptionId?: string;
  readonly errorId?: string;
  readonly hasError: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> {
  readonly id: string;
  readonly label: ReactNode;
  readonly required?: boolean | undefined;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly children: ReactNode;
}

export function Field({
  id,
  label,
  required = false,
  description,
  error,
  className,
  children,
  ...props
}: FieldProps) {
  const hasDescription = description !== undefined && description !== null;
  const hasError = error !== undefined && error !== null;
  const contextValue: FieldContextValue = {
    id,
    required,
    hasError,
    ...(hasDescription ? { descriptionId: `${id}-description` } : {}),
    ...(hasError ? { errorId: `${id}-error` } : {}),
  };

  return (
    <FieldContext.Provider value={contextValue}>
      <div data-slot="field" className={cn('flex flex-col gap-xs', className)} {...props}>
        <FieldLabel>{label}</FieldLabel>
        {children}
        {hasDescription ? <FieldDescription>{description}</FieldDescription> : null}
        {hasError ? <FieldError>{error}</FieldError> : null}
      </div>
    </FieldContext.Provider>
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn('text-body-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}

export function FieldLabel({
  className,
  htmlFor,
  required,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  readonly required?: boolean | undefined;
}) {
  const field = useContext(FieldContext);

  return (
    <Label htmlFor={htmlFor ?? field?.id} className={className} {...props}>
      {children}
      {(required ?? field?.required) ? (
        <span aria-hidden className="text-destructive">
          {' *'}
        </span>
      ) : null}
    </Label>
  );
}

export function FieldDescription({
  className,
  id,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const field = useContext(FieldContext);

  return (
    <p
      data-slot="field-description"
      id={id ?? field?.descriptionId}
      className={cn('text-body-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function FieldError({
  className,
  id,
  role = 'alert',
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const field = useContext(FieldContext);

  return (
    <p
      data-slot="field-error"
      id={id ?? field?.errorId}
      role={role}
      className={cn('text-body-sm text-destructive', className)}
      {...props}
    />
  );
}

export function useFieldContext() {
  return useContext(FieldContext);
}

export function mergeDescribedBy(...ids: readonly (string | undefined)[]): string | undefined {
  const uniqueIds = [...new Set(ids.flatMap((value) => value?.split(/\s+/) ?? []))].filter(Boolean);
  return uniqueIds.length > 0 ? uniqueIds.join(' ') : undefined;
}
