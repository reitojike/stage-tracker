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
 */
export function PrimaryNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      data-slot="primary-nav"
      aria-label="主要ナビゲーション"
      className="flex h-14 shrink-0 items-stretch justify-around border-t border-border bg-card"
    >
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
    </nav>
  );
}
