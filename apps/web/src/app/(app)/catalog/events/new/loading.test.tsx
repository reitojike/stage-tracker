import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewEventLoading from "./loading";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("month=2026-03&date=2026-03-10"),
}));

describe("NewEventLoading", () => {
  it("preserves catalog context and shared loading chrome", async () => {
    render(<NewEventLoading />);

    const backLink = await screen.findByRole("link", {
      name: "イベントカタログへ戻る",
    });
    expect(backLink).toHaveAttribute(
      "href",
      "/catalog?month=2026-03&date=2026-03-10",
    );
    expect(backLink).toHaveAttribute("data-slot", "back-link");
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中…");
  });
});
