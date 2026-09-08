import Link from "next/link";
import type { ReactNode } from "react";

/**
 * `docs/v2/oracle-routes-ui.md` §3 の `BackLink`（「文脈的な『戻る』
 * リンク」）と `PageHeading`（「各画面唯一の `<h1>`」）に相当する最小実装。
 * `packages/ui` にはまだ無く、このタスクの編集範囲の制約により
 * feature-local に置く（`FormField.tsx` の doc comment と同じ理由）。
 */
export function BackLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-body-sm text-primary underline-offset-4 hover:underline"
    >
      {children}
    </Link>
  );
}

export function PageHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h1 className="text-heading font-semibold text-foreground">{children}</h1>
  );
}
