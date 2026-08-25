'use client';

import { useEffect } from 'react';
import { occurrenceAnchorId } from '@/domain/catalogNavigation.ts';

export interface FocusedOccurrenceScrollProps {
  /** The occurrence a selected-day row was chosen for, already validated
   * against this event's actual occurrences by the page (Issue #107), or
   * null when there is none in focus (generic event-level presentation). */
  occurrenceId: string | null;
}

/**
 * Brings the exact occurrence a visitor navigated for into view, and moves
 * keyboard/assistive-technology focus onto it, without requiring a manual
 * scroll or a manual tab-through (Issue #107) - the browser's native
 * "#fragment scrolls the matching id into view on load" behavior only
 * fires for a genuine full page load; the App Router's client-side
 * transition (the common case: tapping a selected-day row) never triggers
 * it, and an event with many occurrences can put the target well below the
 * fold. `scrollIntoView`/`focus` are plain, documented DOM APIs called
 * directly from our own effect - not a dependency on any undocumented
 * Next.js internal navigation/focus behavior.
 *
 * `target` carries `tabIndex={-1}` (see EventDetail.tsx) specifically so it
 * is programmatically focusable here despite not being a native
 * interactive element - without this call, that `tabIndex` serves no
 * purpose and a keyboard/screen-reader user still has to navigate linearly
 * from the top of the page to reach it, the same re-search this feature
 * exists to remove. `preventScroll: true` defers to our own
 * `scrollIntoView` call above for positioning (`block: 'center'`) rather
 * than the browser's default focus-scroll behavior, which would otherwise
 * fight it.
 */
export function FocusedOccurrenceScroll({ occurrenceId }: FocusedOccurrenceScrollProps) {
  useEffect(() => {
    if (occurrenceId === null) {
      return;
    }
    const target = document.getElementById(occurrenceAnchorId(occurrenceId));
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
  }, [occurrenceId]);

  return null;
}
