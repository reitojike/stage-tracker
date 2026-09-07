import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge variant="outline">組</Badge>);
    expect(screen.getByText("組")).toBeInTheDocument();
  });

  it("stamps data-variant for each of the 5 semantic variants", () => {
    const variants = [
      "outline",
      "subtle",
      "done",
      "deadline",
      "terminal",
    ] as const;
    for (const variant of variants) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>);
      expect(container.querySelector("[data-slot='badge']")).toHaveAttribute(
        "data-variant",
        variant,
      );
      unmount();
    }
  });

  it("only the done variant renders its own checkmark glyph", () => {
    const { container: doneContainer } = render(
      <Badge variant="done">申し込み済み</Badge>,
    );
    expect(doneContainer.querySelector("svg")).toBeInTheDocument();

    const { container: subtleContainer } = render(
      <Badge variant="subtle">申し込む予定</Badge>,
    );
    expect(subtleContainer.querySelector("svg")).not.toBeInTheDocument();
  });

  it("never runs (compile-time only) - variant is required with no default", () => {
    function assertVariantIsRequired() {
      // @ts-expect-error - `variant` is required; Badge must not guess a
      // default meaning.
      return <Badge>variant なし</Badge>;
    }
    void assertVariantIsRequired;
  });
});
