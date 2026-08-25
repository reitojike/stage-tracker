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
 * Brings the exact occurrence a visitor navigated for into view without
 * requiring a manual scroll (Issue #107) - the browser's native
 * "#fragment scrolls the matching id into view on load" behavior only
 * fires for a genuine full page load; the App Router's client-side
 * transition (the common case: tapping a selected-day row) never triggers
 * it, and an event with many occurrences can put the target well below the
 * fold. `scrollIntoView` is a plain, documented DOM API called directly
 * from our own effect - not a dependency on any undocumented Next.js
 * internal navigation/focus behavior.
 */
export function FocusedOccurrenceScroll({ occurrenceId }: FocusedOccurrenceScrollProps) {
  useEffect(() => {
    if (occurrenceId === null) {
      return;
    }
    const target = document.getElementById(occurrenceAnchorId(occurrenceId));
    target?.scrollIntoView({ block: 'center' });
  }, [occurrenceId]);

  return null;
}
