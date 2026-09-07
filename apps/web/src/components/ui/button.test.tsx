import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children as an accessible button", () => {
    render(<Button>クリック</Button>);

    expect(
      screen.getByRole("button", { name: "クリック" }),
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>送信</Button>);

    await user.click(screen.getByRole("button", { name: "送信" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        無効
      </Button>,
    );

    const button = screen.getByRole("button", { name: "無効" });
    expect(button).toBeDisabled();

    await user.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  // decisions.md A1: variant (meaning) and size (dimension) are independent
  // axes. These pin the specific legacy `danger`/`icon` mappings this task
  // decided on.
  describe("variant/size 2-axis mapping (decisions.md A1)", () => {
    it('maps legacy "danger" to variant="destructive" (shadcn\'s irreversible/destructive-action semantic)', () => {
      render(<Button variant="destructive">削除</Button>);
      expect(screen.getByRole("button", { name: "削除" })).toHaveClass(
        "bg-destructive/10",
      );
    });

    it('maps legacy "icon" to size="icon" at 40x40 (size-10), not shadcn\'s default 32px', () => {
      render(
        <Button variant="ghost" size="icon" aria-label="アイコン">
          x
        </Button>,
      );
      expect(screen.getByRole("button", { name: "アイコン" })).toHaveClass(
        "size-10",
      );
    });

    it('combines any variant with any size independently (e.g. legacy "small" = outline chrome + sm size)', () => {
      render(
        <Button variant="outline" size="sm">
          small
        </Button>,
      );
      const button = screen.getByRole("button", { name: "small" });
      expect(button).toHaveClass("border-border");
      expect(button).toHaveClass("h-7");
    });
  });
});
