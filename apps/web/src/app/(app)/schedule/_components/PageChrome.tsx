import type { ReactNode } from "react";
import { BackLink as SharedBackLink } from "@stage-tracker/ui";

/**
 * Feature-local wrapper around the shared `BackLink`; exact navigation and
 * presentation are owned by this runtime component.
 */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return <SharedBackLink href={href}>{children}</SharedBackLink>;
}

export { PageHeading, SectionHeading } from "@stage-tracker/ui";
