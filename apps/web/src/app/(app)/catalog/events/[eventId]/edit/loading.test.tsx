import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EditEventLoading from "./loading";

describe("EditEventLoading", () => {
  it("keeps the stable edit heading while loading", () => {
    render(<EditEventLoading />);

    expect(
      screen.getByRole("heading", { name: "イベントを編集" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("読み込み中…");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
