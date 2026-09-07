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
});
