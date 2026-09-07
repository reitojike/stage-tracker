import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PrimaryNav } from "./primary-nav";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
// vi.mock calls are hoisted above imports by Vitest's transform, so
// PrimaryNav's `usePathname` binding resolves to this mock.
vi.mock("next/navigation", () => ({ usePathname }));

describe("PrimaryNav", () => {
  it("renders exactly the 4 fixed items (decisions.md P2)", () => {
    usePathname.mockReturnValue("/");
    render(<PrimaryNav />);

    const nav = screen.getByRole("navigation", { name: "主要ナビゲーション" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(4);
    expect(screen.getByRole("link", { name: /ホーム/ })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /イベント/ })).toHaveAttribute(
      "href",
      "/catalog",
    );
    expect(screen.getByRole("link", { name: /チケット/ })).toHaveAttribute(
      "href",
      "/tickets",
    );
    expect(screen.getByRole("link", { name: /カレンダー/ })).toHaveAttribute(
      "href",
      "/calendar",
    );
  });

  it("marks the current location with aria-current AND a non-color cue (bold text)", () => {
    usePathname.mockReturnValue("/catalog");
    render(<PrimaryNav />);

    const active = screen.getByRole("link", { name: /イベント/ });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active.className).toMatch(/font-semibold/);

    const inactive = screen.getByRole("link", { name: /ホーム/ });
    expect(inactive).not.toHaveAttribute("aria-current");
    expect(inactive.className).toMatch(/font-medium/);
  });

  it("treats nested routes as active (e.g. /catalog/events/1 highlights イベント)", () => {
    usePathname.mockReturnValue("/catalog/events/1");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: /イベント/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it('does not treat "/" as a prefix match for every other route', () => {
    usePathname.mockReturnValue("/catalog");
    render(<PrimaryNav />);

    expect(screen.getByRole("link", { name: /ホーム/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // PR #377 review: the mobile bottom-nav UX contract (pin to viewport
  // bottom while scrolling, clear the iOS home indicator, match the
  // bounded content column) is not a CSS implementation detail - regressing
  // any of these classes silently breaks the nav's on-screen behavior with
  // no type/runtime error. Asserted by class presence rather than a pixel
  // snapshot, per apps/legacy-web/src/ui/PrimaryNav.module.css `.nav`/
  // `.items`/`.link`.
  describe("layout contract (legacy PrimaryNav.module.css parity)", () => {
    it("pins the nav shell to the viewport bottom while scrolling", () => {
      usePathname.mockReturnValue("/");
      render(<PrimaryNav />);

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      expect(nav.className).toMatch(/\bsticky\b/);
      expect(nav.className).toMatch(/\bbottom-0\b/);
    });

    it("keeps the nav shell clear of the iOS home indicator via safe-area padding", () => {
      usePathname.mockReturnValue("/");
      render(<PrimaryNav />);

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      expect(nav.className).toMatch(/pb-\[env\(safe-area-inset-bottom,0px\)\]/);
    });

    it("gives the nav shell its own stacking context (does not rely on DOM order alone)", () => {
      usePathname.mockReturnValue("/");
      render(<PrimaryNav />);

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      expect(nav.className).toMatch(/z-\[1\]/);
    });

    it("bounds the inner row to the same 640px content column as AppShell", () => {
      usePathname.mockReturnValue("/");
      render(<PrimaryNav />);

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      const row = nav.firstElementChild;
      expect(row).not.toBeNull();
      expect(row?.className).toMatch(/max-w-\[640px\]/);
      expect(row?.className).toMatch(/\bmx-auto\b/);
    });

    it("keeps each tap target at the 60px WCAG 2.5.8 target size (via the row's min-height)", () => {
      usePathname.mockReturnValue("/");
      render(<PrimaryNav />);

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      const row = nav.firstElementChild;
      // 60px, not 56px (Issue #188 raised it from 56 to 60 for a two-line
      // label) - min-h-15 = 15 * 0.25rem = 60px under Tailwind v4's default
      // --spacing scale.
      expect(row?.className).toMatch(/\bmin-h-15\b/);
    });
  });
});
