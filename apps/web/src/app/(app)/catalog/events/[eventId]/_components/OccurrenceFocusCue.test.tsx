import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OccurrenceFocusCue } from "./OccurrenceFocusCue";

describe("OccurrenceFocusCue", () => {
  it("renders the focused occurrence cue as plain semantic text, not a Badge", () => {
    render(<OccurrenceFocusCue />);

    const cue = screen.getByText("選択した公演回");
    expect(cue).toHaveAttribute("data-slot", "occurrence-focus-cue");
    expect(cue.closest('[data-slot="badge"]')).toBeNull();
  });
});
