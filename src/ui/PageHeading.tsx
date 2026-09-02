import type { ReactNode } from 'react';
import styles from './PageHeading.module.css';

export interface PageHeadingProps {
  children: ReactNode;
  className?: string;
}

/**
 * The single page-level `<h1>` inside AppShell's content column. Exists so
 * every Gate A screen states what it is at the same size and weight -
 * before #70 each page hand-rolled a bare `<h1>` and inherited whatever
 * the UA stylesheet gave it, which is a large part of why the screens read
 * as unfinished. Heading hierarchy stays restrained per docs/ux-ui.md
 * "Typography": one step above body text, not a display size.
 */
export function PageHeading({ children, className }: PageHeadingProps) {
  return <h1 className={[styles.heading, className].filter(Boolean).join(' ')}>{children}</h1>;
}
