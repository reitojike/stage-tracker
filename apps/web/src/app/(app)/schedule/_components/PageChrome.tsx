import type { ReactNode } from "react";
import { BackLink as SharedBackLink } from "@stage-tracker/ui";

/**
 * `docs/v2/oracle-routes-ui.md` §3 の `BackLink`（「文脈的な『戻る』
 * リンク」）に相当する feature-local wrapper。
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
