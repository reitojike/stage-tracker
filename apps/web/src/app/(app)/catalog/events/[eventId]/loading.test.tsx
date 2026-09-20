import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EventDetailLoading from "./loading";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("month=2026-03&date=2026-03-10"),
}));

describe("EventDetailLoading", () => {
  it("preserves catalog context without re-owning AppShell bounds", () => {
    render(<EventDetailLoading />);

    const backLink = screen.getByRole("link", { name: "一覧へ戻る" });
    expect(backLink).toHaveAttribute(
      "href",
      "/catalog?month=2026-03&date=2026-03-10",
    );
    expect(backLink).toHaveAttribute("data-slot", "back-link");
    expect(backLink.parentElement).toHaveClass("flex", "w-full", "gap-md");
    expect(backLink.parentElement).not.toHaveClass(
      "mx-auto",
      "max-w-[640px]",
      "p-md",
    );
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中…");
  });
});
