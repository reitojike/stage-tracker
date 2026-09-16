import type { ReactNode } from 'react';

export type PageHeadingProps = {
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * The single page-level heading primitive. Consumers may add layout classes,
 * but the heading typography and semantic element stay owned by shared UI.
 */
export function PageHeading({ children, className }: PageHeadingProps) {
  return (
    <h1
      className={`text-heading leading-heading font-semibold text-foreground${
        className ? ` ${className}` : ''
      }`}
    >
      {children}
    </h1>
  );
}
