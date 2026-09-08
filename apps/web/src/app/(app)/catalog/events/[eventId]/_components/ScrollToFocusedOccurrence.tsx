"use client";

import { useEffect } from "react";

export interface ScrollToFocusedOccurrenceProps {
  readonly occurrenceId: string | null;
}

/**
 * `docs/v2/oracle-routes-ui.md` §1 の `searchParams: ... occurrence`
 * （フォーカス対象）を実際に画面上へ反映する。`page.tsx` は
 * `id={`occurrence-${occurrence.id}`}` を各行へ既に付与しているため、
 * ここでは対象行までスクロールするだけでよい。`?occurrence=` はクエリ
 * パラメータであり `#hash` ではないため、ブラウザの native anchor
 * スクロールには乗らない — この最小限の client component が担う。
 */
export function ScrollToFocusedOccurrence({
  occurrenceId,
}: ScrollToFocusedOccurrenceProps) {
  useEffect(() => {
    if (occurrenceId === null) {
      return;
    }
    document
      .getElementById(`occurrence-${occurrenceId}`)
      ?.scrollIntoView({ block: "start" });
  }, [occurrenceId]);

  return null;
}
