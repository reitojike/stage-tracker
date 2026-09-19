import type { ComponentProps } from 'react';

export type SectionHeadingProps = ComponentProps<'h2'>;

/**
 * Shared typography and h2 semantics for genuine content sections.
 * Border placement and color stay with the caller because they describe the
 * section's role, not the heading's typography.
 */
export function SectionHeading({ className, ...props }: SectionHeadingProps) {
  return (
    <h2
      {...props}
      className={`text-title leading-title font-semibold text-foreground${
        className ? ` ${className}` : ''
      }`}
    />
  );
}
