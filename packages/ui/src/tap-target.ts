/**
 * Keeps compact controls visually small while guaranteeing the 44px pointer
 * target recorded in docs/ux-ui.md. The pseudo-element is part of the
 * interactive element, so no extra wrapper or bespoke event handling is
 * needed.
 */
export const TAP_TARGET_44_CLASS =
  "relative touch-manipulation before:absolute before:top-1/2 before:left-1/2 before:h-[max(100%,2.75rem)] before:w-[max(100%,2.75rem)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']";
