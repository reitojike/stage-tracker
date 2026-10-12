"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { TicketsView } from "../_lib/tickets-view";

/** Recover a fragment consumed while the async ticket page was still loading. */
export function TicketOpportunityAnchorList({
  anchorIds,
  view,
  children,
}: {
  readonly anchorIds: string;
  readonly view: TicketsView;
  readonly children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let targetId: string;
    try {
      targetId = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!anchorIds.split(" ").includes(targetId)) return;
    const target = container.current?.querySelector<HTMLElement>(
      `[id="${targetId}"]`,
    );
    if (target === null || target === undefined) return;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    target.focus({ preventScroll: true });
  }, [anchorIds, view]);

  return (
    <div ref={container} className="flex flex-col gap-lg">
      {children}
    </div>
  );
}
