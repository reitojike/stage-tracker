"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, Theater, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Fixed 4-item bottom navigation (docs/v2/oracle-routes-ui.md §3 PrimaryNav).
 * PO decision P2 (docs/v2/decisions.md, 2026-09-07): this stays exactly
 * these 4 items. `/schedule` and `/mypage` are reached through contextual
 * entry points (the calendar's day picker, the AppBar avatar) rather than
 * from here - do not add items without a new PO decision superseding P2.
 */
const PRIMARY_NAV_ITEMS = [
  { href: "/", label: "ホーム", Icon: Home },
  { href: "/catalog", label: "イベント", Icon: Theater },
  { href: "/tickets", label: "チケット", Icon: Ticket },
  { href: "/calendar", label: "カレンダー", Icon: CalendarDays },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * No props - it determines the current location itself via `usePathname`
 * (docs/v2/oracle-routes-ui.md §3: "props なし（usePathnameで自己判定）").
 * The active item is marked by both a color cue *and* a non-color cue
 * (bold label + underline bar + `aria-current="page"`), matching the
 * oracle's "色＋非色的手がかりの両方で表現".
 *
 * Structure is split into a nav shell and an inner row (PR #377 review:
 * apps/legacy-web/src/ui/PrimaryNav.module.css `.nav`/`.items`/`.link` had
 * this same two-tier shape, lost in the initial v2 port):
 * - shell (`<nav>`): the mobile bottom-nav UX contract - `sticky`/`bottom-0`
 *   so it pins to the viewport bottom while the page scrolls (this only
 *   works because AppShell is a full-height flex column - see
 *   app-shell.tsx), a `z-[1]` stacking context (matches legacy's `.nav`/
 *   `.appBar` z-index so this and AppBar never fight for stacking order
 *   despite neither ever actually overlapping the other), and
 *   `env(safe-area-inset-bottom)` bottom padding so the row stays clear of
 *   the iOS home indicator. Tailwind v4 has no theme-level utility for
 *   `env()`, so this is an arbitrary value (same precedent as
 *   `max-w-[640px]` below and in app-shell.tsx) with the same `0px`
 *   fallback legacy uses for browsers without the env.
 * - inner row (`<div>`): the visual row contract - bounded to the same
 *   640px column as AppShell's content (`max-w-[640px]` + `mx-auto`) and a
 *   `min-h-15` (60px = legacy's exact `.link { min-height: 60px }`, also
 *   reused as `--primary-nav-row-height` by
 *   apps/legacy-web/src/ui/fixedSubmitBar.module.css - not an arbitrary
 *   number, WCAG 2.5.8 target size with room for a two-line label).
 */
export function PrimaryNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      data-slot="primary-nav"
      aria-label="主要ナビゲーション"
      className="sticky bottom-0 z-[1] shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="mx-auto flex min-h-15 max-w-[640px] items-stretch justify-around">
        {PRIMARY_NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-2xs text-caption",
                active
                  ? "font-semibold text-primary"
                  : "font-medium text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="size-5" />
              <span>{label}</span>
              <span
                aria-hidden
                className={cn(
                  "h-0.5 w-6 rounded-pill",
                  active ? "bg-primary" : "bg-transparent",
                )}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
