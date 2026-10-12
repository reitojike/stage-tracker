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
  const revealedTarget = useRef<string | null>(null);

  useEffect(() => {
    let targetId: string;
    try {
      targetId = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      revealedTarget.current = null;
      return;
    }
    if (!anchorIds.split(" ").includes(targetId)) {
      revealedTarget.current = null;
      return;
    }
    // Later data refreshes must leave the user's current control focus alone.
    if (revealedTarget.current === targetId) return;
    const target = container.current?.querySelector<HTMLElement>(
      `[id="${targetId}"]`,
    );
    if (target === null || target === undefined) return;
    revealedTarget.current = targetId;
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    target.focus({ preventScroll: true });
  }, [anchorIds, view]);

  return (
    <div ref={container} className="flex flex-col gap-lg">
      {children}
    </div>
  );
}
